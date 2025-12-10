import { useMessagingStore } from "../store/messagingStore";

import type { MessageSubmitStreamingResponseAssistantMessageStarted } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * Handles the `assistant_message_started` event from the SSE stream.
 * Sets the streaming state in the store and marks that the first chunk is no longer awaited.
 */
export const handleAssistantMessageStarted = (
  data: MessageSubmitStreamingResponseAssistantMessageStarted,
): void => {
  const { message_id } = data;
  if (!message_id) {
    console.warn(
      "[DEBUG_STREAMING] handleAssistantMessageStarted: 'assistant_message_started' event received without a message_id:",
      data,
    );
    return;
  }

  const { setStreaming, setAwaitingFirstStreamChunkForNewChat } =
    useMessagingStore.getState();

  const currentStreaming = useMessagingStore.getState().streaming;

  // Check if we have an optimistic placeholder
  const hasOptimistic =
    currentStreaming.currentMessageId?.startsWith("temp-assistant-");

  if (hasOptimistic) {
    if (process.env.NODE_ENV === "development") {
      console.log(
        `[DEBUG_STREAMING] handleAssistantMessageStarted: Replacing optimistic ID ${currentStreaming.currentMessageId} with real ID ${message_id}, preserving timestamp ${currentStreaming.createdAt}`,
      );
    }
    // Replace temp ID with real ID, preserve createdAt for ordering
    setStreaming({
      isStreaming: true,
      currentMessageId: message_id, // Real UUID from backend
      content: [], // Reset content for new stream
      createdAt: currentStreaming.createdAt, // Preserve timestamp
    });
  } else {
    if (process.env.NODE_ENV === "development") {
      console.log(
        `[DEBUG_STREAMING] handleAssistantMessageStarted: No optimistic placeholder found (backend was faster). Creating new with ID: ${message_id}`,
      );
    }
    // No optimistic (edge case: backend was faster than optimistic creation)
    setStreaming({
      isStreaming: true,
      currentMessageId: message_id,
      content: [],
      createdAt: new Date().toISOString(), // Use current time as fallback
    });
  }

  // Reset the awaiting flag in the store as the stream has started
  setAwaitingFirstStreamChunkForNewChat(false);
};
