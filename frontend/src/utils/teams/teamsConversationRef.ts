/**
 * What a Teams selection points at, as the transcript index records it.
 *
 * Types only, and deliberately so: the constructors live beside the Teams
 * picker that mints them, and nothing that merely reads a transcript needs to
 * build one. Keeping this module free of runtime code also keeps the identity
 * shape importable from anywhere without dragging a bundle along.
 *
 * Chats and channels are both conversations to the picker, but Graph addresses
 * them differently — a chat by id, a channel by the team that owns it — so the
 * reference stays structured rather than collapsing into one string that later
 * has to be re-parsed.
 */

export interface TeamsChatConversationRef {
  kind: "chat";
  chatId: string;
}

export interface TeamsChannelConversationRef {
  kind: "channel";
  teamId: string;
  channelId: string;
}

export type TeamsConversationRef =
  | TeamsChatConversationRef
  | TeamsChannelConversationRef;

/**
 * A single message, addressable end to end. One shape, one place: the
 * transcript index and anything that later resolves a message back to Graph
 * have to name a message the same way, or the two hold different identities
 * for the same thing.
 *
 * A channel reply is not addressable on its own — Graph only serves it under
 * its root — so the root travels with the reference instead of being looked up
 * again at resolve time.
 */
export interface TeamsMessageRef {
  conversation: TeamsConversationRef;
  messageId: string;
  /** Root of a channel reply; null for roots and for chat messages. */
  parentMessageId: string | null;
}
