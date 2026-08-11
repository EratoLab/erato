/**
 * What the user ticked in the picker, and the identity of the transcript that
 * selection builds — what lets a retry reuse a build instead of walking Graph
 * again. The key deliberately describes the *selection*, not the fetch result:
 * the oldest message id is unknown until paging finishes, and "the user asked
 * for this conversation again" is the identity that matters.
 */

import { DEFAULT_CHAT_MESSAGE_LIMIT } from "./teamsChatPager";
import { conversationKey } from "./teamsConversationRef";

import type { TeamsConversationRef } from "./teamsConversationRef";

export type TeamsChatSelection =
  | { kind: "conversation"; ref: TeamsConversationRef; title: string }
  | {
      kind: "message";
      ref: TeamsConversationRef;
      messageId: string;
      /** Required to re-fetch a channel reply, which has no addressable id. */
      parentMessageId?: string | null;
      conversationTitle: string;
      senderName: string;
      createdAt: string | null;
    };

/**
 * Individually-ticked messages each cost a gated round-trip, so the count is
 * bounded before the user commits rather than discovered as a stall.
 */
export const MAX_SELECTED_MESSAGES = 25;

export interface TeamsChatSelectionGroup {
  ref: TeamsConversationRef;
  title: string;
  /** Whole-conversation ingest wins over individual ticks within the same one. */
  whole: boolean;
  messageIds: string[];
  /** Parent id per ticked message, for channel replies only. */
  parents: Record<string, string>;
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
      messageIds: [],
      parents: {},
    };
    if (selection.kind === "conversation") {
      existing.whole = true;
      existing.title = selection.title;
    } else {
      existing.messageIds.push(selection.messageId);
      if (selection.parentMessageId) {
        existing.parents[selection.messageId] = selection.parentMessageId;
      }
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
        : `teams:${key}:${[...group.messageIds].sort().join(",")}`;
    })
    .sort()
    .join("+");
}

export function countSelectedMessages(
  selections: readonly TeamsChatSelection[],
): number {
  return selections.filter((selection) => selection.kind === "message").length;
}
