import type { Message } from "@erato/frontend/library";

/**
 * Send-time item identity to anchor an edited exchange on.
 *
 * An edit replays the ORIGINAL email — it rides in the stored user message and
 * facet args — so the wrong-item guard must use the identity that exchange was
 * sent with, never the item open right now, which may be a different email.
 * That identity is stamped on the assistant message that replied to the edited
 * message.
 *
 * Returns null when this session no longer knows it (the map is in-memory, so
 * a reload empties it) or when the edited message has no reply yet. The
 * completion then degrades to a history-like draft rather than being bricked
 * behind a stale-item error.
 */
export function resolveEditExchangeItemIdentity(
  messages: Record<string, Message>,
  messageOrder: readonly string[],
  editedMessageId: string,
  itemIdentityByAssistantId: ReadonlyMap<string, string>,
): string | null {
  const exchangeAssistantId = messageOrder.find(
    (id) =>
      messages[id]?.role === "assistant" &&
      messages[id]?.previous_message_id === editedMessageId,
  );

  return exchangeAssistantId
    ? (itemIdentityByAssistantId.get(exchangeAssistantId) ?? null)
    : null;
}
