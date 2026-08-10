/**
 * Walks one chat's history backwards from the newest message. Strictly
 * sequential: the per-chat gate in {@link listChatMessagesPage} bounds us to
 * 1 rps against a single chat, so a fan-out would only queue behind itself.
 */

import { CHAT_MESSAGE_PAGE_SIZE, listChatMessagesPage } from "./teamsChatGraph";

import type {
  GraphChatMessage,
  TeamsFetchState,
  TeamsGraphCallOptions,
} from "./teamsChatGraph";
import type { GraphTokenSource } from "../../utils/graph/graphClient";

/** Default ingest window — deliberately not the whole history. */
export const DEFAULT_CHAT_MESSAGE_LIMIT = 200;
/** Ceiling "Include earlier" may raise the window to. */
export const MAX_CHAT_MESSAGE_LIMIT = 400;
/**
 * Runaway guard only — the walk is bounded by the message limit. Graph serves
 * short (and sometimes empty) pages, so a page budget derived from the limit
 * would silently return a fraction of what the caller asked for.
 */
export const MAX_CHAT_PAGES = 24;

/**
 * Requests a full-size walk is expected to cost. A progress denominator, not a
 * budget: short pages spend more than this, and the walk is free to.
 */
export function expectedChatPageRequests(limit: number): number {
  return Math.max(1, Math.ceil(limit / CHAT_MESSAGE_PAGE_SIZE));
}

export interface ChatPagingProgress {
  chatId: string;
  fetched: number;
  limit: number;
  oldestCreatedDateTime: string | null;
}

export interface PageChatMessagesResult {
  messages: GraphChatMessage[];
  /** Non-null when older history remains — i.e. the window is truncated. */
  nextLink: string | null;
  oldestCreatedDateTime: string | null;
  state: TeamsFetchState;
}

export async function pageChatMessagesBackwards(
  args: {
    chatId: string;
    tokenSource: GraphTokenSource;
    limit?: number;
    /** Continuation for "load earlier"; omit to start from the newest page. */
    startingAfterLink?: string | null;
    onProgress?: (progress: ChatPagingProgress) => void;
  } & TeamsGraphCallOptions,
): Promise<PageChatMessagesResult> {
  const {
    chatId,
    tokenSource,
    limit = DEFAULT_CHAT_MESSAGE_LIMIT,
    startingAfterLink,
    onProgress,
    signal,
    transport,
  } = args;

  const messages: GraphChatMessage[] = [];
  let nextLink: string | null = startingAfterLink ?? null;
  let pages = 0;
  let state: TeamsFetchState = "ok";

  do {
    const page = await listChatMessagesPage(chatId, tokenSource, {
      nextLink,
      signal,
      transport,
    });
    if (!page.ok) {
      state = pages === 0 ? "error" : "partial";
      break;
    }
    messages.push(...page.messages);
    nextLink = page.nextLink;
    pages += 1;
    onProgress?.({
      chatId,
      fetched: messages.length,
      limit,
      oldestCreatedDateTime: oldestCreatedDateTime(messages),
    });
  } while (
    nextLink !== null &&
    messages.length < limit &&
    pages < MAX_CHAT_PAGES
  );

  return {
    messages: messages.slice(0, limit),
    nextLink,
    oldestCreatedDateTime: oldestCreatedDateTime(messages.slice(0, limit)),
    state,
  };
}

function oldestCreatedDateTime(messages: GraphChatMessage[]): string | null {
  let oldest: string | null = null;
  let oldestMs = Number.POSITIVE_INFINITY;
  for (const message of messages) {
    const created = message.createdDateTime;
    if (!created) continue;
    const parsed = Date.parse(created);
    if (Number.isNaN(parsed) || parsed >= oldestMs) continue;
    oldest = created;
    oldestMs = parsed;
  }
  return oldest;
}
