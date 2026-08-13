/**
 * Constructors for the conversation and message references the picker mints.
 *
 * The shapes themselves live in the frontend library, with the readers of a
 * transcript; only the Teams picker builds one, so only the building lives
 * here. The types are imported, never redeclared — two declarations of one
 * identity is exactly how the two sides come to disagree about it.
 */

import type {
  TeamsChannelConversationRef,
  TeamsChatConversationRef,
  TeamsConversationRef,
  TeamsMessageRef,
} from "@erato/frontend/library";

export type {
  TeamsChannelConversationRef,
  TeamsChatConversationRef,
  TeamsConversationRef,
  TeamsMessageRef,
};

export function messageRef(
  conversation: TeamsConversationRef,
  messageId: string,
  parentMessageId: string | null = null,
): TeamsMessageRef {
  return { conversation, messageId, parentMessageId };
}

/** Stable identity for grouping, dedupe keys and the per-conversation gate. */
export function conversationKey(ref: TeamsConversationRef): string {
  return ref.kind === "chat"
    ? `chat:${ref.chatId}`
    : `channel:${ref.teamId}/${ref.channelId}`;
}

export function chatRef(chatId: string): TeamsChatConversationRef {
  return { kind: "chat", chatId };
}

export function channelRef(
  teamId: string,
  channelId: string,
): TeamsChannelConversationRef {
  return { kind: "channel", teamId, channelId };
}
