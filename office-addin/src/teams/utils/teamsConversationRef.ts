/**
 * What a selection points at. Chats and channels are both conversations to the
 * picker, but Graph addresses them differently — a chat by id, a channel by the
 * team that owns it — so the reference stays structured rather than collapsing
 * into one string that later has to be re-parsed.
 */
export type TeamsConversationRef =
  | { kind: "chat"; chatId: string }
  | { kind: "channel"; teamId: string; channelId: string };

/** Stable identity for grouping, dedupe keys and the per-conversation gate. */
export function conversationKey(ref: TeamsConversationRef): string {
  return ref.kind === "chat"
    ? `chat:${ref.chatId}`
    : `channel:${ref.teamId}/${ref.channelId}`;
}

export function chatRef(chatId: string): TeamsConversationRef {
  return { kind: "chat", chatId };
}

export function channelRef(
  teamId: string,
  channelId: string,
): TeamsConversationRef {
  return { kind: "channel", teamId, channelId };
}
