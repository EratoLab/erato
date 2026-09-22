import { useMessagingStore } from "@erato/frontend/library";

import type { WordDocumentReadSession } from "./wordDocumentReadTool";

/** Bind before sending: SSE can deliver ownership and a tool request before React renders.
 * Approval continuations keep their owner; task children and later requests need a new capture. */
export function bindWordDocumentReadRequest(
  session: WordDocumentReadSession,
  snapshot: string,
  chatId: string | null,
): () => void {
  const initial = useMessagingStore.getState();
  // The stream alias must belong to the request that captured this document.
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
    // An aborted send must not bind its snapshot to a later task.
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
    // Uploads can create the chat before streaming, so a new chat need not have an alias.
    session.bindRequest(snapshot, { chatId: resolvedChatId, messageId });
    unsubscribe();
  });
  return unsubscribe;
}
