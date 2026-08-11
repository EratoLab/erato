/**
 * Microsoft Graph wire layer for Teams chats (1:1 and group; no channels).
 * Delegated `Chat.Read` covers every call here.
 *
 * Two contracts shape this module and are easy to get wrong:
 *   - `POST /search/query` is the only keyword path (`GET /chats/{id}/messages`
 *     has no `$search`), and a search hit carries NO body. Real content needs a
 *     second GET joined on `(resource.chatId, resource.id)` — `hitId` is an
 *     Exchange item id and never addresses a Teams message.
 *   - Every chat-scoped request goes through {@link runGatedByChat}: the 1 rps
 *     per-chat ceiling applies across the pager, the drill-down query and
 *     hydration alike, so the gate cannot live in any one of them.
 */

import { runGatedByChat } from "./teamsChatRateGate";
import { channelRef, chatRef } from "./teamsConversationRef";
import {
  GRAPH_BASE,
  graphFetch,
  retryAfterMs,
  sleep,
} from "../../utils/graph/graphClient";
import { runWithGraphTimeout } from "../../utils/graph/graphRequestTimeout";

import type { TeamsConversationRef } from "./teamsConversationRef";
import type {
  GraphTokenSource,
  GraphTransport,
} from "../../utils/graph/graphClient";

/** Documented `$top` maximum for chat message collections. */
export const CHAT_MESSAGE_PAGE_SIZE = 50;
export const CHAT_LIST_PAGE_SIZE = 50;
/** The chatMessage `size` ceiling is undocumented; start here and back off. */
export const SEARCH_PAGE_SIZE = 25;
const SEARCH_FALLBACK_PAGE_SIZE = 10;
export const TEAMS_GRAPH_REQUEST_TIMEOUT_MS = 15_000;
/** `$expand=members` returns at most this many members per chat. */
export const CHAT_MEMBER_EXPAND_CAP = 25;

export const CHANNEL_MESSAGE_PAGE_SIZE = 50;

export type TeamsFetchState = "ok" | "partial" | "error";

export interface GraphIdentity {
  id?: string;
  displayName?: string;
  userIdentityType?: string;
}

export interface GraphChatMessageFrom {
  user?: GraphIdentity;
  application?: GraphIdentity;
  device?: GraphIdentity;
}

/** Teams bodies are `text` XOR `html`, never both; a mention forces `html`. */
export interface GraphChatMessageBody {
  contentType?: "text" | "html";
  content?: string;
}

export interface GraphChatMessageAttachment {
  id?: string;
  contentType?: string;
  name?: string | null;
}

export interface GraphChannelIdentity {
  teamId?: string | null;
  channelId?: string | null;
}

export interface GraphChatMessage {
  /** Populated only for channel messages; null in a chat. */
  channelIdentity?: GraphChannelIdentity | null;
  id?: string;
  chatId?: string;
  messageType?: string;
  createdDateTime?: string;
  lastEditedDateTime?: string | null;
  deletedDateTime?: string | null;
  from?: GraphChatMessageFrom | null;
  body?: GraphChatMessageBody;
  attachments?: GraphChatMessageAttachment[];
  /**
   * Populated for channel messages and null in a chat. Graph's own link
   * carries groupId, tenantId and parentMessageId, none of which we can
   * reconstruct, so it is always preferred over building one.
   */
  webUrl?: string | null;
}

export interface GraphChatMember {
  id?: string;
  displayName?: string | null;
  userId?: string | null;
  email?: string | null;
}

export interface GraphChat {
  id?: string;
  /** Always null for `oneOnOne` chats — the title comes from the members. */
  topic?: string | null;
  chatType?: string;
  createdDateTime?: string;
  lastUpdatedDateTime?: string;
  members?: GraphChatMember[];
  lastMessagePreview?: GraphChatMessage | null;
}

/** A search hit as returned by `/search/query` — metadata and a snippet only. */
export interface TeamsSearchHit {
  /**
   * Classified from `channelIdentity`, never from `chatId`: a channel hit
   * carries the channel's thread id in `chatId`, so trusting it routes the
   * hydration at the chat endpoint and 404s.
   */
  ref: TeamsConversationRef;
  /** `resource.id`, the Teams message id. Never `hitId`. */
  messageId: string;
  senderName: string;
  createdAt: string | null;
  /** Raw highlight snippet; still carries `<c0>` markers. */
  summary: string;
  /** Shorter than the resource's `webUrl` and without `parentMessageId`. */
  webLink: string | null;
}

export interface TeamsGraphCallOptions {
  signal?: AbortSignal;
  transport?: GraphTransport;
}

interface GraphJsonResult<T> {
  ok: boolean;
  status: number;
  payload: T | null;
}

interface GraphInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

/**
 * One Graph JSON round-trip under a per-request timeout, optionally behind the
 * per-chat gate, honouring a single `Retry-After` on 429. Returns the status
 * instead of throwing so callers can degrade to `partial`; aborts propagate.
 */
async function requestGraphJson<T>(args: {
  url: string;
  tokenSource: GraphTokenSource;
  gateKey?: string | null;
  init?: GraphInit;
  options: TeamsGraphCallOptions;
}): Promise<GraphJsonResult<T>> {
  const { url, tokenSource, gateKey, init, options } = args;
  const parentSignal = options.signal;
  const transport = options.transport ?? globalThis.fetch.bind(globalThis);

  // The gate wraps `graphFetch`, so its 401 force-refresh replay rides inside
  // one slot rather than waiting out another interval — a rare extra request
  // against the chat, traded for not re-queueing behind unrelated pages.
  const send = (signal: AbortSignal) => {
    const call = () =>
      graphFetch(url, tokenSource, "application/json", signal, transport, init);
    return gateKey ? runGatedByChat(gateKey, signal, call) : call();
  };

  try {
    return await runWithGraphTimeout(
      TEAMS_GRAPH_REQUEST_TIMEOUT_MS,
      `Teams Graph request timed out after ${TEAMS_GRAPH_REQUEST_TIMEOUT_MS}ms`,
      parentSignal,
      async (signal) => {
        let response = await send(signal);
        if (response.status === 429) {
          const retryMs = retryAfterMs(response);
          if (retryMs !== null) {
            await sleep(retryMs, signal);
            response = await send(signal);
          }
        }
        if (!response.ok) {
          return { ok: false, status: response.status, payload: null };
        }
        const payload = (await response.json()) as T;
        return { ok: true, status: response.status, payload };
      },
    );
  } catch (error) {
    if (parentSignal?.aborted) {
      throw parentSignal.reason ?? error;
    }
    console.warn("[teamsChatGraph] request failed:", url, error);
    return { ok: false, status: 0, payload: null };
  }
}

export interface ListTeamsChatsResult {
  chats: GraphChat[];
  nextLink: string | null;
  state: TeamsFetchState;
}

/**
 * One page of the signed-in user's chats. No `$orderby` — Graph rejects it on
 * expanded navigation properties often enough that callers sort client-side on
 * `lastMessagePreview.createdDateTime` instead.
 */
export async function listTeamsChatsPage(
  tokenSource: GraphTokenSource,
  options: TeamsGraphCallOptions & { nextLink?: string | null } = {},
): Promise<ListTeamsChatsResult> {
  const url =
    options.nextLink ??
    `${GRAPH_BASE}/me/chats?$expand=members,lastMessagePreview&$top=${CHAT_LIST_PAGE_SIZE}`;
  const result = await requestGraphJson<{
    value?: GraphChat[];
    "@odata.nextLink"?: string;
  }>({ url, tokenSource, options });
  if (!result.ok || !result.payload) {
    return { chats: [], nextLink: null, state: "error" };
  }
  return {
    chats: result.payload.value ?? [],
    nextLink: result.payload["@odata.nextLink"] ?? null,
    state: "ok",
  };
}

/** A single chat, for search hits whose chat is outside the browsed window. */
export async function getTeamsChat(
  chatId: string,
  tokenSource: GraphTokenSource,
  options: TeamsGraphCallOptions = {},
): Promise<GraphChat | null> {
  const url = `${GRAPH_BASE}/chats/${encodeURIComponent(chatId)}?$expand=members`;
  const result = await requestGraphJson<GraphChat>({
    url,
    tokenSource,
    gateKey: chatId,
    options,
  });
  return result.ok ? (result.payload ?? null) : null;
}

export interface ListChatMessagesPageResult {
  messages: GraphChatMessage[];
  nextLink: string | null;
  status: number;
  ok: boolean;
}

/**
 * One page of a chat's messages, newest first. Chat messages sort descending
 * only, so following `@odata.nextLink` *is* paging backwards through history.
 */
export async function listChatMessagesPage(
  chatId: string,
  tokenSource: GraphTokenSource,
  options: TeamsGraphCallOptions & { nextLink?: string | null } = {},
): Promise<ListChatMessagesPageResult> {
  const url =
    options.nextLink ??
    `${GRAPH_BASE}/chats/${encodeURIComponent(chatId)}/messages?$top=${CHAT_MESSAGE_PAGE_SIZE}`;
  const result = await requestGraphJson<{
    value?: GraphChatMessage[];
    "@odata.nextLink"?: string;
  }>({ url, tokenSource, gateKey: chatId, options });
  if (!result.ok || !result.payload) {
    return {
      messages: [],
      nextLink: null,
      status: result.status,
      ok: false,
    };
  }
  return {
    messages: result.payload.value ?? [],
    nextLink: result.payload["@odata.nextLink"] ?? null,
    status: result.status,
    ok: true,
  };
}

/** A single message with its body — the second phase of a search selection. */
export async function getChatMessage(
  chatId: string,
  messageId: string,
  tokenSource: GraphTokenSource,
  options: TeamsGraphCallOptions = {},
): Promise<GraphChatMessage | null> {
  const url = `${GRAPH_BASE}/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`;
  const result = await requestGraphJson<GraphChatMessage>({
    url,
    tokenSource,
    gateKey: chatId,
    options,
  });
  return result.ok ? (result.payload ?? null) : null;
}

export interface GraphTeam {
  id?: string;
  displayName?: string | null;
  description?: string | null;
}

export interface GraphChannel {
  id?: string;
  displayName?: string | null;
  description?: string | null;
  membershipType?: string | null;
  layoutType?: string | null;
  isArchived?: boolean | null;
  webUrl?: string | null;
}

/**
 * Graph's one-request-per-second ceiling is per conversation, and a channel is
 * a conversation — so channel reads share the chat gate under a composite key.
 */
export function channelGateKey(teamId: string, channelId: string): string {
  return `channel:${teamId}/${channelId}`;
}

export interface ListJoinedTeamsResult {
  teams: GraphTeam[];
  state: TeamsFetchState;
}

/** Teams the signed-in user belongs to. Needs `Team.ReadBasic.All`. */
export async function listJoinedTeams(
  tokenSource: GraphTokenSource,
  options: TeamsGraphCallOptions = {},
): Promise<ListJoinedTeamsResult> {
  const result = await requestGraphJson<{ value?: GraphTeam[] }>({
    url: `${GRAPH_BASE}/me/joinedTeams`,
    tokenSource,
    options,
  });
  if (!result.ok || !result.payload) {
    return { teams: [], state: "error" };
  }
  return { teams: result.payload.value ?? [], state: "ok" };
}

export interface ListTeamChannelsResult {
  channels: GraphChannel[];
  state: TeamsFetchState;
}

/**
 * Channels of one team. Private and shared channels the user is not a member
 * of are omitted by Graph, so the list matches what their Teams rail shows.
 */
export async function listTeamChannels(
  teamId: string,
  tokenSource: GraphTokenSource,
  options: TeamsGraphCallOptions = {},
): Promise<ListTeamChannelsResult> {
  const result = await requestGraphJson<{ value?: GraphChannel[] }>({
    url: `${GRAPH_BASE}/teams/${encodeURIComponent(teamId)}/channels`,
    tokenSource,
    options,
  });
  if (!result.ok || !result.payload) {
    return { channels: [], state: "error" };
  }
  return { channels: result.payload.value ?? [], state: "ok" };
}

/**
 * One page of a channel's root posts, with their replies expanded. The plain
 * list returns roots only, so without `$expand` a post-layout channel reads as
 * a series of openers with every answer missing. Expanding costs nothing extra
 * against the per-channel ceiling; fetching replies per post would cost one
 * gated request each.
 */
export async function listChannelMessagesPage(
  teamId: string,
  channelId: string,
  tokenSource: GraphTokenSource,
  options: TeamsGraphCallOptions & { nextLink?: string | null } = {},
): Promise<ListChatMessagesPageResult> {
  const url =
    options.nextLink ??
    `${GRAPH_BASE}/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages?$top=${CHANNEL_MESSAGE_PAGE_SIZE}&$expand=replies`;
  const result = await requestGraphJson<{
    value?: (GraphChatMessage & { replies?: GraphChatMessage[] })[];
    "@odata.nextLink"?: string;
  }>({
    url,
    tokenSource,
    gateKey: channelGateKey(teamId, channelId),
    options,
  });
  if (!result.ok || !result.payload) {
    return { messages: [], nextLink: null, status: result.status, ok: false };
  }
  return {
    messages: flattenChannelReplies(result.payload.value ?? []),
    nextLink: result.payload["@odata.nextLink"] ?? null,
    status: result.status,
    ok: true,
  };
}

/**
 * Interleaves each root post with its replies, oldest reply first, so the
 * transcript reads as a conversation rather than a list of openers.
 */
function flattenChannelReplies(
  roots: readonly (GraphChatMessage & { replies?: GraphChatMessage[] })[],
): GraphChatMessage[] {
  const flattened: GraphChatMessage[] = [];
  for (const root of roots) {
    flattened.push(root);
    const replies = [...(root.replies ?? [])].sort(
      (a, b) =>
        Date.parse(a.createdDateTime ?? "") -
        Date.parse(b.createdDateTime ?? ""),
    );
    flattened.push(...replies);
  }
  return flattened;
}

/** A single channel message with its body. */
export async function getChannelMessage(
  teamId: string,
  channelId: string,
  messageId: string,
  tokenSource: GraphTokenSource,
  options: TeamsGraphCallOptions = {},
): Promise<GraphChatMessage | null> {
  const result = await requestGraphJson<GraphChatMessage>({
    url: `${GRAPH_BASE}/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`,
    tokenSource,
    gateKey: channelGateKey(teamId, channelId),
    options,
  });
  return result.ok ? (result.payload ?? null) : null;
}

export interface SearchChatMessagesResult {
  hits: TeamsSearchHit[];
  moreResultsAvailable: boolean;
  /** `from` for the next page. Owned here because the size can be negotiated. */
  nextFrom: number;
  state: TeamsFetchState;
}

interface GraphSearchResponse {
  value?: Array<{
    hitsContainers?: Array<{
      hits?: Array<{
        hitId?: string;
        summary?: string;
        resource?: {
          id?: string;
          chatId?: string;
          channelIdentity?: GraphChannelIdentity | null;
          createdDateTime?: string;
          /**
           * Substrate-shaped, not the Graph identity set the resource docs
           * describe — a live search hit carries `from.emailAddress`.
           */
          from?:
            | (GraphChatMessageFrom & {
                emailAddress?: { name?: string; address?: string } | null;
              })
            | null;
          /** Search returns `webLink`, not the resource's `webUrl`. */
          webLink?: string | null;
        };
      }>;
      moreResultsAvailable?: boolean;
    }>;
  }>;
}

function searchHitRef(resource?: {
  chatId?: string;
  channelIdentity?: GraphChannelIdentity | null;
}): TeamsConversationRef | null {
  if (!resource) return null;
  const teamId = resource.channelIdentity?.teamId;
  const channelId = resource.channelIdentity?.channelId;
  if (teamId && channelId) return channelRef(teamId, channelId);
  if (resource.chatId) return chatRef(resource.chatId);
  return null;
}

export async function searchChatMessages(
  query: string,
  tokenSource: GraphTokenSource,
  options: TeamsGraphCallOptions & { from?: number; size?: number } = {},
): Promise<SearchChatMessagesResult> {
  const from = options.from ?? 0;
  const requestedSize = options.size ?? SEARCH_PAGE_SIZE;

  const post = (size: number) =>
    requestGraphJson<GraphSearchResponse>({
      url: `${GRAPH_BASE}/search/query`,
      tokenSource,
      options,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: [
            {
              entityTypes: ["chatMessage"],
              query: { queryString: query },
              from,
              size,
            },
          ],
        }),
      },
    });

  let servedSize = requestedSize;
  let result = await post(servedSize);
  // The chatMessage page-size ceiling is undocumented; a 400 is most often the
  // service refusing the requested `size`.
  if (
    !result.ok &&
    result.status === 400 &&
    requestedSize > SEARCH_FALLBACK_PAGE_SIZE
  ) {
    servedSize = SEARCH_FALLBACK_PAGE_SIZE;
    result = await post(servedSize);
  }
  if (!result.ok || !result.payload) {
    return {
      hits: [],
      moreResultsAvailable: false,
      nextFrom: from,
      state: "error",
    };
  }

  const container = result.payload.value?.[0]?.hitsContainers?.[0];
  const hits: TeamsSearchHit[] = [];
  for (const hit of container?.hits ?? []) {
    const messageId = hit.resource?.id;
    if (!messageId) continue;
    const ref = searchHitRef(hit.resource);
    if (!ref) continue;
    hits.push({
      ref,
      messageId,
      senderName:
        hit.resource?.from?.user?.displayName ??
        hit.resource?.from?.emailAddress?.name ??
        hit.resource?.from?.application?.displayName ??
        "",
      createdAt: hit.resource?.createdDateTime ?? null,
      summary: hit.summary ?? "",
      webLink: hit.resource?.webLink ?? null,
    });
  }
  return {
    hits,
    moreResultsAvailable: container?.moreResultsAvailable ?? false,
    nextFrom: from + servedSize,
    state: "ok",
  };
}

export interface SearchSummarySegment {
  text: string;
  highlighted: boolean;
}

/**
 * Splits a hit summary on the `<c0>…</c0>` highlight markers so the row can
 * render them as elements — the snippet is never injected as HTML.
 */
export function splitSearchSummaryHighlights(
  summary: string,
): SearchSummarySegment[] {
  const segments: SearchSummarySegment[] = [];
  const pattern = /<c\d+>([\s\S]*?)<\/c\d+>/g;
  let cursor = 0;
  let match = pattern.exec(summary);
  while (match !== null) {
    if (match.index > cursor) {
      segments.push({
        text: summary.slice(cursor, match.index),
        highlighted: false,
      });
    }
    segments.push({ text: match[1], highlighted: true });
    cursor = match.index + match[0].length;
    match = pattern.exec(summary);
  }
  if (cursor < summary.length) {
    segments.push({ text: summary.slice(cursor), highlighted: false });
  }
  return segments.filter((segment) => segment.text.length > 0);
}
