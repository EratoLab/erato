import { useMessagingStore } from "../store/messagingStore";

import type { MessageSubmitStreamingResponseAssistantMessageStarted } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * Handles the 'assistant_message_started' event from the streaming API response.
 *
 * This event signifies that the backend has started generating the assistant's message
 * and has assigned it a permanent ID. This handler updates the streaming state
 * in the messaging store with this actual message ID, sets the streaming flag to true,
 * and resets the content buffer for the new message. This eliminates the need for
 * a temporary ID for the assistant's message.
 *
 * @param responseData - The data from the 'assistant_message_started' SSE event.
 *                       It must contain `message_id`, the permanent ID for the
 *                       assistant's message that is about to be streamed.
 * @returns void
 */
export const handleAssistantMessageStarted = (
  responseData: MessageSubmitStreamingResponseAssistantMessageStarted & {
    message_type: "assistant_message_started";
  },
): void => {
  if (!responseData.message_id) {
    console.warn(
      "[CHAT_FLOW] 'assistant_message_started' event received without a message_id:",
      responseData,
    );
    return;
  }

  const { setStreaming } = useMessagingStore.getState();
  setStreaming({
    isStreaming: true,
    currentMessageId: responseData.message_id,
    content: "", // Ensure content starts fresh for the new message
  });

  if (process.env.NODE_ENV === "development") {
    console.log(
      `[CHAT_FLOW] Assistant message started. ID: ${responseData.message_id}`,
    );
  }
};
