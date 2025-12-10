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
  if (process.env.NODE_ENV === "development") {
    // Log only a snippet to avoid too much noise, or log less frequently
    console.log(
      `[DEBUG_STREAMING] handleTextDelta: Received delta: "${responseData.new_text ? responseData.new_text.substring(0, 30) + "..." : "[EMPTY_DELTA]"}", Current message ID in store: ${useMessagingStore.getState().streaming.currentMessageId}`,
    );
  }
  useMessagingStore.setState((state) => {
    if (process.env.NODE_ENV === "development") {
      // Check if we are actually appending to the correct message
      if (state.streaming.currentMessageId) {
        console.log(
          `[DEBUG_STORE] handleTextDelta: Appending to message ID ${state.streaming.currentMessageId}. Prev content parts: ${state.streaming.content.length}, New delta: "${responseData.new_text}"`,
        );
      } else {
        console.warn(
          `[DEBUG_STORE] handleTextDelta: Attempted to append delta but no currentMessageId in store. Delta: "${responseData.new_text}"`,
        );
      }
    }

    // Get the current content array
    const currentContent = state.streaming.content;
    const lastPart =
      currentContent.length > 0
        ? currentContent[currentContent.length - 1]
        : null;

    // If the last part is a text part, append to it; otherwise create a new text part
    let updatedContent;
    if (lastPart && lastPart.content_type === "text") {
      updatedContent = [
        ...currentContent.slice(0, -1),
        {
          content_type: "text" as const,
          text: lastPart.text + responseData.new_text,
        },
      ];
    } else {
      updatedContent = [
        ...currentContent,
        { content_type: "text" as const, text: responseData.new_text },
      ];
    }

    return {
      ...state,
      streaming: {
        ...state.streaming,
        content: updatedContent,
      },
    };
  });
};
