/**
 * Fetches the bodies behind a picker selection and assembles the transcript
 * sections. This is where the two-phase search contract is paid off: a hit
 * carries no body, so every selected message is hydrated here by
 * `(chatId, messageId)` before anything is serialized.
 *
 * Chats run three at a time — each task is itself a multi-second serial pager
 * against a 1 rps-per-chat ceiling, and the tenant-wide budget is shared with
 * everything else in the tenant. Progress is counted in *requests*, because
 * that is the only denominator known up front: message totals are not.
 */

import { parseTeamsChat, parseTeamsMessage } from "./parsedTeamsChat";
import {
  DEFAULT_CHAT_MESSAGE_LIMIT,
  expectedChatPageRequests,
} from "./teamsChatPager";
import { groupSelectionsByConversation } from "./teamsChatSelection";
import { conversationKey } from "./teamsConversationRef";
import { runWithConcurrency } from "../../utils/graph/graphClient";

import type { TeamsTranscriptSection } from "./buildTeamsTranscriptFile";
import type { ParsedTeamsChannel } from "./parsedTeamsChannel";
import type {
  ParsedTeamsChat,
  ParsedTeamsMessage,
  TeamsSelfIdentity,
} from "./parsedTeamsChat";
import type { TeamsChannelFetcher, TeamsChatFetcher } from "./teamsChatFetcher";
import type { GraphChatMessage, TeamsFetchState } from "./teamsChatGraph";
import type { TeamsChatSelection } from "./teamsChatSelection";

/** Simultaneous chats. Lower than the Outlook fan-out: each task is serial. */
export const TEAMS_CHAT_CONCURRENCY = 3;

export interface TeamsTranscriptProgress {
  /** Expected Graph requests — the one denominator known before fetching. */
  requestsTotal: number;
  requestsCompleted: number;
  chatsTotal: number;
  chatsCompleted: number;
  messagesFetched: number;
  oldestCreatedDateTime: string | null;
}

export interface CollectTeamsTranscriptResult {
  sections: TeamsTranscriptSection[];
  state: TeamsFetchState;
  messageCount: number;
  /** Selected messages that could not be loaded (deleted, or 404 on hydrate). */
  skippedCount: number;
  chatsTotal: number;
  chatsCompleted: number;
}

export interface CollectTeamsTranscriptArgs {
  fetcher: TeamsChatFetcher;
  selections: readonly TeamsChatSelection[];
  /** Chat metadata already in the browse cache, keyed by chat id. */
  knownChats?: ReadonlyMap<string, ParsedTeamsChat>;
  /** Present only where the channel scopes were granted. */
  channelFetcher?: TeamsChannelFetcher | null;
  /** Channel metadata from the browse cache, keyed by `teamId/channelId`. */
  knownChannels?: ReadonlyMap<string, ParsedTeamsChannel>;
  self?: TeamsSelfIdentity;
  limit?: number;
  onProgress?: (progress: TeamsTranscriptProgress) => void;
  signal?: AbortSignal;
}

export async function collectTeamsTranscript(
  args: CollectTeamsTranscriptArgs,
): Promise<CollectTeamsTranscriptResult> {
  const {
    fetcher,
    channelFetcher,
    selections,
    knownChats,
    knownChannels,
    self,
    onProgress,
    signal,
  } = args;
  const limit = args.limit ?? DEFAULT_CHAT_MESSAGE_LIMIT;
  const groups = groupSelectionsByConversation(selections);
  const wholeChatRequests = expectedChatPageRequests(limit);

  const groupRequests = groups.map((group) =>
    group.whole ? wholeChatRequests : group.messageIds.length,
  );
  const requestsTotal = groupRequests.reduce((sum, count) => sum + count, 0);

  let requestsCompleted = 0;
  let chatsCompleted = 0;
  let messagesFetched = 0;
  let oldest: string | null = null;
  const emit = () =>
    onProgress?.({
      requestsTotal,
      requestsCompleted,
      chatsTotal: groups.length,
      chatsCompleted,
      messagesFetched,
      oldestCreatedDateTime: oldest,
    });

  const noteOldest = (candidate: string | null) => {
    if (!candidate) return;
    if (oldest === null || Date.parse(candidate) < Date.parse(oldest)) {
      oldest = candidate;
    }
  };

  const sections: Array<TeamsTranscriptSection | null> = groups.map(() => null);
  const outcomes: TeamsFetchState[] = groups.map(() => "ok");
  let skippedCount = 0;

  const tasks = groups.map((group, index) => async () => {
    let spent = 0;
    try {
      if (group.ref.kind === "channel") {
        const ref = group.ref;
        if (!channelFetcher) {
          // The channel scopes were not granted; say nothing rather than
          // attaching an empty section that looks like an empty channel.
          outcomes[index] = "error";
          return;
        }
        let counted = 0;
        const collected = await collectChannelMessages({
          channelFetcher,
          ref,
          whole: group.whole,
          messageIds: group.messageIds,
          parents: group.parents,
          limit,
          signal,
          onPage: (fetched, oldest) => {
            spent = Math.min(spent + 1, groupRequests[index]);
            requestsCompleted += 1;
            messagesFetched += fetched - counted;
            counted = fetched;
            noteOldest(oldest);
            emit();
          },
          onMessage: () => {
            spent = Math.min(spent + 1, groupRequests[index]);
            requestsCompleted += 1;
            emit();
          },
        });
        if (!group.whole) {
          messagesFetched += collected.messages.length;
          for (const message of collected.messages)
            noteOldest(message.createdAt);
        }
        skippedCount += collected.skipped;
        outcomes[index] = collected.state;
        sections[index] = {
          kind: "channel",
          channel:
            knownChannels?.get(`${ref.teamId}/${ref.channelId}`) ??
            fallbackChannel(ref, group.title),
          messages: collected.messages,
          selection: group.whole ? "whole-chat" : "messages",
          limit: group.whole ? limit : undefined,
          truncated: collected.truncated,
          skippedCount: collected.skipped,
        };
        return;
      }
      const chatId = group.ref.chatId;
      const chat = await resolveChat(fetcher, chatId, group.title, {
        knownChats,
        self,
        signal,
      });
      if (group.whole) {
        // The pager reports a running total per chat; the shared counter takes
        // the delta so a live count is visible while the walk is in progress.
        let counted = 0;
        const page = await fetcher.pageChatBackwards({
          chatId,
          limit,
          signal,
          onProgress: (progress) => {
            spent = Math.min(spent + 1, groupRequests[index]);
            requestsCompleted += 1;
            messagesFetched += progress.fetched - counted;
            counted = progress.fetched;
            noteOldest(progress.oldestCreatedDateTime);
            emit();
          },
        });
        outcomes[index] = page.state;
        const messages = collectParsed(page.messages, chatId);
        messagesFetched += messages.length - counted;
        sections[index] = {
          kind: "chat",
          chat,
          messages,
          selection: "whole-chat",
          limit,
          truncated: page.truncated,
        };
      } else {
        const messages: ParsedTeamsMessage[] = [];
        let skipped = 0;
        for (const messageId of group.messageIds) {
          const raw = await fetcher.getMessage(chatId, messageId, {
            signal,
          });
          spent = Math.min(spent + 1, groupRequests[index]);
          requestsCompleted += 1;
          const parsed = raw ? parseTeamsMessage(raw, chatId) : null;
          if (parsed) {
            messages.push(parsed);
            noteOldest(parsed.createdAt);
          } else {
            skipped += 1;
          }
          messagesFetched += parsed ? 1 : 0;
          emit();
        }
        skippedCount += skipped;
        if (skipped > 0 && messages.length === 0) {
          outcomes[index] = "error";
        } else if (skipped > 0) {
          outcomes[index] = "partial";
        }
        sections[index] = {
          kind: "chat",
          chat,
          messages: sortNewestFirst(messages),
          selection: "messages",
          skippedCount: skipped,
        };
      }
    } catch (error) {
      // Abort and per-conversation failure both degrade to a partial
      // transcript; the caller decides whether to offer what landed.
      outcomes[index] = sections[index] ? "partial" : "error";
      if (!signal?.aborted) {
        console.warn(
          "[collectTeamsTranscript] chat failed:",
          conversationKey(group.ref),
          error,
        );
      }
    } finally {
      requestsCompleted += groupRequests[index] - spent;
      chatsCompleted += 1;
      emit();
    }
  });

  emit();
  await runWithConcurrency(tasks, TEAMS_CHAT_CONCURRENCY);

  const present = sections.filter(
    (section): section is TeamsTranscriptSection =>
      section !== null && section.messages.length > 0,
  );
  return {
    sections: present,
    state: overallState(outcomes, present.length),
    messageCount: present.reduce(
      (sum, section) => sum + section.messages.length,
      0,
    ),
    skippedCount,
    chatsTotal: groups.length,
    chatsCompleted,
  };
}

/**
 * Whole-channel ingest uses the same recency window as a chat: newest pages
 * first, stopping at the limit, so a channel with years of history costs the
 * same as a busy chat rather than minutes of gated paging.
 */
function fallbackChannel(
  ref: { teamId: string; channelId: string },
  title: string,
): ParsedTeamsChannel {
  return {
    ref: { kind: "channel", ...ref },
    teamId: ref.teamId,
    channelId: ref.channelId,
    name: title,
    teamName: "",
    membershipType: "standard",
    isThreaded: true,
  };
}

async function collectChannelMessages(args: {
  channelFetcher: TeamsChannelFetcher;
  ref: { teamId: string; channelId: string };
  whole: boolean;
  messageIds: readonly string[];
  parents: Record<string, string>;
  limit: number;
  signal?: AbortSignal;
  onPage?: (fetched: number, oldest: string | null) => void;
  onMessage?: () => void;
}): Promise<{
  messages: ParsedTeamsMessage[];
  state: TeamsFetchState;
  truncated: boolean;
  skipped: number;
}> {
  const { channelFetcher, ref, whole, messageIds, limit, signal } = args;
  const conversationId = `${ref.teamId}/${ref.channelId}`;
  if (whole) {
    const page = await channelFetcher.pageChannelBackwards({
      teamId: ref.teamId,
      channelId: ref.channelId,
      limit,
      signal,
      onProgress: (progress) =>
        args.onPage?.(progress.fetched, progress.oldestCreatedDateTime),
    });
    return {
      messages: collectParsed(page.messages, conversationId),
      state: page.state,
      truncated: page.truncated,
      skipped: 0,
    };
  }
  const messages: ParsedTeamsMessage[] = [];
  let skipped = 0;
  for (const messageId of messageIds) {
    // A reply is not addressable through the messages endpoint, so a ticked
    // one is fetched under its parent instead.
    const parentId = args.parents[messageId];
    const raw = parentId
      ? await channelFetcher.getReply(
          ref.teamId,
          ref.channelId,
          parentId,
          messageId,
          { signal },
        )
      : await channelFetcher.getMessage(ref.teamId, ref.channelId, messageId, {
          signal,
        });
    args.onMessage?.();
    const parsed = raw ? parseTeamsMessage(raw, conversationId) : null;
    if (parsed) messages.push(parsed);
    else skipped += 1;
  }
  const state: TeamsFetchState =
    skipped > 0 && messages.length === 0
      ? "error"
      : skipped > 0
        ? "partial"
        : "ok";
  return {
    messages: sortNewestFirst(messages),
    state,
    truncated: false,
    skipped,
  };
}

async function resolveChat(
  fetcher: TeamsChatFetcher,
  chatId: string,
  fallbackTitle: string,
  context: {
    knownChats?: ReadonlyMap<string, ParsedTeamsChat>;
    self?: TeamsSelfIdentity;
    signal?: AbortSignal;
  },
): Promise<ParsedTeamsChat> {
  const known = context.knownChats?.get(chatId);
  if (known) return known;
  const fetched = await fetcher.getChat(chatId, { signal: context.signal });
  const parsed = fetched ? parseTeamsChat(fetched, context.self) : null;
  return (
    parsed ?? {
      chatId,
      title: fallbackTitle,
      participants: [],
      participantsTruncated: false,
      chatType: "unknown",
      lastActivityAt: null,
      previewText: "",
    }
  );
}

function collectParsed(
  messages: GraphChatMessage[],
  chatId: string,
): ParsedTeamsMessage[] {
  const parsed: ParsedTeamsMessage[] = [];
  for (const message of messages) {
    const entry = parseTeamsMessage(message, chatId);
    if (entry) parsed.push(entry);
  }
  return parsed;
}

function sortNewestFirst(messages: ParsedTeamsMessage[]): ParsedTeamsMessage[] {
  const time = (message: ParsedTeamsMessage): number => {
    const parsed = Date.parse(message.createdAt ?? "");
    return Number.isNaN(parsed) ? 0 : parsed;
  };
  return [...messages].sort((a, b) => time(b) - time(a));
}

function overallState(
  outcomes: TeamsFetchState[],
  presentSections: number,
): TeamsFetchState {
  if (outcomes.length === 0) return "error";
  if (presentSections === 0) return "error";
  return outcomes.every((outcome) => outcome === "ok") ? "ok" : "partial";
}
