import { useMessagingStore } from "../store/messagingStore";

import type { MessageSubmitStreamingResponseMessageComplete } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * Handles the 'assistant_message_completed' event from the streaming API response.
 *
 * This event signifies that the backend has finished streaming the assistant's message.
 * This handler updates the streaming state in the messaging store to reflect completion,
 * setting the final content and the real message ID.
 *
 * @param responseData - The data from the 'assistant_message_completed' SSE event.
 *                       It should contain the final message details, including its real ID.
 */
export const handleMessageComplete = (
  responseData: MessageSubmitStreamingResponseMessageComplete & {
    message_type: "assistant_message_completed";
  },
): void => {
  const { setStreaming, streaming: currentStreamingState } =
    useMessagingStore.getState();

  // Extract real message data from the backend
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const realMessageData = responseData.message || {};
  // It's assumed that if 'assistant_message_completed' is received,
  // a valid message ID will be present in responseData.message.id or responseData.message_id.
  const realMessageId = realMessageData.id || responseData.message_id;
  const finalContent =
    realMessageData.full_text ||
    responseData.full_text ||
    currentStreamingState.content; // Fallback to current streaming content if somehow not in response

  if (process.env.NODE_ENV === "development") {
    console.log(
      "[CHAT_FLOW] Assistant message completed. Real ID:",
      realMessageId,
      "Final content snippet:",
      finalContent.substring(0, 50),
    );
  }

  // Update streaming state to indicate completion
  setStreaming({
    isStreaming: false,
    content: finalContent,
    currentMessageId: realMessageId || null, // Update to real ID
  });
};
