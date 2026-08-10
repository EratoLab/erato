/**
 * What the user ticked in the picker, and the identity of the transcript that
 * selection builds — what lets a retry reuse a build instead of walking Graph
 * again. The key deliberately describes the *selection*, not the fetch result:
 * the oldest message id is unknown until paging finishes, and "the user asked
 * for this chat again" is the identity that matters.
 */

import { DEFAULT_CHAT_MESSAGE_LIMIT } from "./teamsChatPager";

export type TeamsChatSelection =
  | { kind: "chat"; chatId: string; title: string }
  | {
      kind: "message";
      chatId: string;
      messageId: string;
      chatTitle: string;
      senderName: string;
      createdAt: string | null;
    };

/**
 * Individually-ticked messages each cost a gated round-trip, so the count is
 * bounded before the user commits rather than discovered as a stall.
 */
export const MAX_SELECTED_MESSAGES = 25;

export interface TeamsChatSelectionGroup {
  chatId: string;
  title: string;
  /** Whole-chat ingest wins over individual ticks within the same chat. */
  wholeChat: boolean;
  messageIds: string[];
}

export function teamsSelectionKey(selection: TeamsChatSelection): string {
  return selection.kind === "chat"
    ? `chat:${selection.chatId}`
    : `msg:${selection.chatId}:${selection.messageId}`;
}

export function groupSelectionsByChat(
  selections: readonly TeamsChatSelection[],
): TeamsChatSelectionGroup[] {
  const groups = new Map<string, TeamsChatSelectionGroup>();
  for (const selection of selections) {
    const existing = groups.get(selection.chatId) ?? {
      chatId: selection.chatId,
      title: selection.kind === "chat" ? selection.title : selection.chatTitle,
      wholeChat: false,
      messageIds: [],
    };
    if (selection.kind === "chat") {
      existing.wholeChat = true;
      existing.title = selection.title;
    } else {
      existing.messageIds.push(selection.messageId);
    }
    groups.set(selection.chatId, existing);
  }
  return Array.from(groups.values());
}

export function teamsSelectionDedupeKey(
  selections: readonly TeamsChatSelection[],
  limit: number = DEFAULT_CHAT_MESSAGE_LIMIT,
): string {
  return groupSelectionsByChat(selections)
    .map((group) =>
      group.wholeChat
        ? `teams:${group.chatId}:all-${limit}`
        : `teams:${group.chatId}:${[...group.messageIds].sort().join(",")}`,
    )
    .sort()
    .join("+");
}

export function countSelectedMessages(
  selections: readonly TeamsChatSelection[],
): number {
  return selections.filter((selection) => selection.kind === "message").length;
}
