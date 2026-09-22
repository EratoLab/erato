import { useMessagingStore } from "@erato/frontend/library";

import type { WordDocumentReadSession } from "./wordDocumentReadTool";

/** Arm immediately before sending. The shared store receives the server's
 * assistant_message_started event synchronously, before client_tool_call,
 * even when both arrive in one SSE chunk with no React render between them.
 * Bind once: an approval continuation keeps the same message; a task child or
 * later reaction needs its own explicit capture instead of adopting this one.
 */
export function bindWordDocumentReadRequest(
  session: WordDocumentReadSession,
  snapshot: string,
  chatId: string | null,
): () => void {
  const initial = useMessagingStore.getState();
  // A new chat's stream key is rebound to its real id by chat_created. Keep
  // this send's key, not the global newlyCreatedChatId or active chat later on.
  const streamKey = chatId ?? initial.activeStreamKey;
  const previousId = initial.getStreaming(streamKey).currentMessageId;
  let sawPendingSend = false;
  const unsubscribe = useMessagingStore.subscribe((state) => {
    const stream = state.getStreaming(streamKey);
    const messageId = stream.currentMessageId;
    if (messageId?.startsWith("temp-")) {
      sawPendingSend = true;
      return;
    }
    // A failed/aborted send with no server message must not leave a grant
    // waiting to bind to a later task reaction in this chat.
    if (sawPendingSend && !messageId) {
      unsubscribe();
      return;
    }
    if (!stream.isStreaming || !messageId || messageId === previousId) return;
    let resolvedChatId = streamKey;
    const visited = new Set<string>();
    while (state.streamKeyAliases[resolvedChatId]) {
      if (visited.has(resolvedChatId)) return;
      visited.add(resolvedChatId);
      resolvedChatId = state.streamKeyAliases[resolvedChatId];
    }
    // An upload can create a persisted chat before its first send. In that
    // case the captured key is already the real id and needs no alias.
    session.bindRequest(snapshot, { chatId: resolvedChatId, messageId });
    unsubscribe();
  });
  return unsubscribe;
}
