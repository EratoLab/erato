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
  if (process.env.NODE_ENV === "development") {
    console.log(
      `[DEBUG_STREAMING] handleAssistantMessageStarted: Setting streaming store. Message ID: ${message_id}, isStreaming: true, content: ""`,
    );
  }
  setStreaming({
    isStreaming: true,
    currentMessageId: message_id,
    content: "", // Ensure content starts fresh for the new message
  });

  // Reset the awaiting flag in the store as the stream has started
  setAwaitingFirstStreamChunkForNewChat(false);

  if (process.env.NODE_ENV === "development") {
    // Optional: Additional logging if needed
    // console.log(
    //   `[CHAT_FLOW] Assistant message started (handler). ID: ${message_id}`,
    // );
  }
};
