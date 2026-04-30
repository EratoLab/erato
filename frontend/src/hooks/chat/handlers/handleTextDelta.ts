import { useMessagingStore } from "../store/messagingStore";

import type {
  ContentPart,
  MessageSubmitStreamingResponseMessageTextDelta,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export function appendTextLikeDelta(
  currentContent: ContentPart[],
  contentIndex: number,
  contentType: "text" | "reasoning",
  newText: string,
): ContentPart[] {
  const updatedContent = [...currentContent];
  const existingPart =
    contentIndex < updatedContent.length ? updatedContent[contentIndex] : null;

  if (existingPart?.content_type === contentType) {
    updatedContent[contentIndex] = {
      ...existingPart,
      text: existingPart.text + newText,
    };
    return updatedContent;
  }

  const nextPart =
    contentType === "text"
      ? ({ content_type: "text", text: newText } as const)
      : ({ content_type: "reasoning", text: newText } as const);

  if (contentIndex >= updatedContent.length) {
    updatedContent.push(nextPart);
  } else {
    updatedContent.splice(contentIndex, 0, nextPart);
  }

  return updatedContent;
}

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
  streamKey?: string,
): void => {
  // Update the streaming content by directly modifying the store state
  // This approach is more performant than using the setter functions
  // because it bypasses multiple state transformations that could cause UI lag
  if (process.env.NODE_ENV === "development") {
    // Log only a snippet to avoid too much noise, or log less frequently
    console.log(
      `[DEBUG_STREAMING] handleTextDelta: Received delta: "${responseData.new_text ? responseData.new_text.substring(0, 30) + "..." : "[EMPTY_DELTA]"}", Current message ID in store: ${useMessagingStore.getState().getStreaming(streamKey).currentMessageId}`,
    );
  }
  useMessagingStore.setState(
    (state) => {
      const resolvedStreamKey = streamKey ?? state.activeStreamKey;
      const currentStreaming =
        state.streamingByKey[resolvedStreamKey] ?? state.streaming;

      if (process.env.NODE_ENV === "development") {
        // Check if we are actually appending to the correct message
        if (currentStreaming.currentMessageId) {
          console.log(
            `[DEBUG_STORE] handleTextDelta: Appending to message ID ${currentStreaming.currentMessageId}. Prev content parts: ${currentStreaming.content.length}, New delta: "${responseData.new_text}"`,
          );
        } else {
          console.warn(
            `[DEBUG_STORE] handleTextDelta: Attempted to append delta but no currentMessageId in store. Delta: "${responseData.new_text}"`,
          );
        }
      }

      const updatedContent = appendTextLikeDelta(
        currentStreaming.content,
        responseData.content_index,
        "text",
        responseData.new_text,
      );

      return {
        ...state,
        streamingByKey: {
          ...state.streamingByKey,
          [resolvedStreamKey]: {
            ...currentStreaming,
            content: updatedContent,
          },
        },
        streaming:
          state.activeStreamKey === resolvedStreamKey
            ? {
                ...currentStreaming,
                content: updatedContent,
              }
            : state.streaming,
      };
    },
    false,
    "messaging/handleTextDelta",
  );
};
