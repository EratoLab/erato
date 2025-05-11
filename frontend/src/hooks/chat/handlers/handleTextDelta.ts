import { useMessagingStore } from "../store/messagingStore";

import type { MessageSubmitStreamingResponseMessageTextDelta } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * Handles text delta events from the streaming API response.
 *
 * This handler efficiently updates the messaging store with new text chunks
 * as they arrive from the server-sent events (SSE) stream. It directly
 * manipulates the store state to avoid unnecessary re-renders and performance
 * bottlenecks during rapid text streaming.
 *
 * @param responseData - The text delta data received from the streaming API
 *                       Contains the new text chunk to append to the current message
 * @returns void
 */
export const handleTextDelta = (
  responseData: MessageSubmitStreamingResponseMessageTextDelta & {
    message_type: "text_delta";
  },
): void => {
  // Update the streaming content by directly modifying the store state
  // This approach is more performant than using the setter functions
  // because it bypasses multiple state transformations that could cause UI lag
  useMessagingStore.setState((state) => ({
    ...state,
    streaming: {
      ...state.streaming,
      content: state.streaming.content + responseData.new_text,
    },
  }));
};
