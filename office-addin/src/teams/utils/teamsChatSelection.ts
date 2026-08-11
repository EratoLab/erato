/**
 * What the user ticked in the picker, and the identity of the transcript that
 * selection builds — what lets a retry reuse a build instead of walking Graph
 * again. The key deliberately describes the *selection*, not the fetch result:
 * the oldest message id is unknown until paging finishes, and "the user asked
 * for this conversation again" is the identity that matters.
 */

import { DEFAULT_CHAT_MESSAGE_LIMIT } from "./teamsChatPager";
import { conversationKey } from "./teamsConversationRef";

import type { ParsedTeamsMessage } from "./parsedTeamsChat";
import type {
  TeamsChannelConversationRef,
  TeamsChatConversationRef,
  TeamsConversationRef,
} from "./teamsConversationRef";

interface TeamsMessageSelectionCommon {
  kind: "message";
  messageId: string;
  conversationTitle: string;
  senderName: string;
  createdAt: string | null;
  /**
   * The body as the picker already parsed it — from the drill-in list or the
   * tick-time probe. When present the collector attaches it directly; only
   * search-origin chat hits, which carry no body, still hydrate.
   */
  message?: ParsedTeamsMessage;
}

/**
 * A chat message is addressable by id alone; a channel message is not — a
 * reply resolves only under its thread root. A channel selection therefore
 * states where the message sits, and there is deliberately no "don't know"
 * value: the picker resolves placement before a channel message becomes
 * selectable, instead of the fetch discovering it as a 404.
 */
export type TeamsMessageSelection =
  | (TeamsMessageSelectionCommon & { ref: TeamsChatConversationRef })
  | (TeamsMessageSelectionCommon & {
      ref: TeamsChannelConversationRef;
      /** Thread root the message hangs under; null when it is the root. */
      parentMessageId: string | null;
    });

export type TeamsChatSelection =
  | { kind: "conversation"; ref: TeamsConversationRef; title: string }
  | TeamsMessageSelection;

/**
 * Individually-ticked messages are bounded before the user commits: one
 * without a cached body costs a gated round-trip, and the transcript should
 * stay a curated excerpt rather than a bulk export.
 */
export const MAX_SELECTED_MESSAGES = 25;

export interface TeamsSelectedMessage {
  messageId: string;
  /** Thread root for channel replies; null for roots and for chat messages. */
  parentMessageId: string | null;
  /** Already-parsed body; null means the collector must fetch it. */
  message: ParsedTeamsMessage | null;
}

export interface TeamsChatSelectionGroup {
  ref: TeamsConversationRef;
  title: string;
  /** Whole-conversation ingest wins over individual ticks within the same one. */
  whole: boolean;
  messages: TeamsSelectedMessage[];
}

export function teamsSelectionKey(selection: TeamsChatSelection): string {
  const base = conversationKey(selection.ref);
  return selection.kind === "conversation"
    ? `whole:${base}`
    : `msg:${base}:${selection.messageId}`;
}

export function groupSelectionsByConversation(
  selections: readonly TeamsChatSelection[],
): TeamsChatSelectionGroup[] {
  const groups = new Map<string, TeamsChatSelectionGroup>();
  for (const selection of selections) {
    const key = conversationKey(selection.ref);
    const existing = groups.get(key) ?? {
      ref: selection.ref,
      title:
        selection.kind === "conversation"
          ? selection.title
          : selection.conversationTitle,
      whole: false,
      messages: [],
    };
    if (selection.kind === "conversation") {
      existing.whole = true;
      existing.title = selection.title;
    } else {
      existing.messages.push({
        messageId: selection.messageId,
        parentMessageId:
          "parentMessageId" in selection ? selection.parentMessageId : null,
        message: selection.message ?? null,
      });
    }
    groups.set(key, existing);
  }
  return Array.from(groups.values());
}

export function teamsSelectionDedupeKey(
  selections: readonly TeamsChatSelection[],
  limit: number = DEFAULT_CHAT_MESSAGE_LIMIT,
): string {
  return groupSelectionsByConversation(selections)
    .map((group) => {
      const key = conversationKey(group.ref);
      return group.whole
        ? `teams:${key}:all-${limit}`
        : `teams:${key}:${group.messages
            .map((message) => message.messageId)
            .sort()
            .join(",")}`;
    })
    .sort()
    .join("+");
}

export function countSelectedMessages(
  selections: readonly TeamsChatSelection[],
): number {
  return selections.filter((selection) => selection.kind === "message").length;
}
