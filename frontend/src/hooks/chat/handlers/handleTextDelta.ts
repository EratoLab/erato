import { createLogger } from "@/utils/debugLogger";

import { useMessagingStore } from "../store/messagingStore";

import type {
  ContentPart,
  MessageSubmitStreamingResponseMessageTextDelta,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const logger = createLogger("EVENT", "handleTextDelta");

export function appendTextLikeDelta(
  currentContent: ContentPart[],
  contentIndex: number,
  contentType: "text" | "reasoning" | "spoken",
  newText: string,
): ContentPart[] {
  const updatedContent = [...currentContent];
  const existingPart =
    contentIndex < updatedContent.length ? updatedContent[contentIndex] : null;

  if (existingPart?.content_type === contentType) {
    updatedContent[contentIndex] = {
      ...existingPart,
      text: (existingPart.text ?? "") + newText,
    };
    return updatedContent;
  }

  // The server turns a spoken part that never closed into the start of the
  // written text, and sends the rest as text at the same index.
  if (contentType === "text" && existingPart?.content_type === "spoken") {
    updatedContent[contentIndex] = {
      content_type: "text",
      text: existingPart.text + newText,
    };
    return updatedContent;
  }

  const nextPart: ContentPart =
    contentType === "reasoning"
      ? { content_type: "reasoning", text: newText }
      : { content_type: contentType, text: newText };

  if (contentIndex >= updatedContent.length) {
    updatedContent.push(nextPart);
  } else {
    updatedContent.splice(contentIndex, 0, nextPart);
  }

  return updatedContent;
}

/**
 * Appends a text-like delta to the streaming message of `streamKey` (the
 * active stream when absent).
 */
export function applyTextLikeDelta(
  contentType: "text" | "reasoning" | "spoken",
  contentIndex: number,
  newText: string,
  streamKey: string | undefined,
  actionName: string,
): void {
  useMessagingStore.setState(
    (state) => {
      const resolvedStreamKey = streamKey ?? state.activeStreamKey;
      const currentStreaming =
        state.streamingByKey[resolvedStreamKey] ?? state.streaming;
      const updatedContent = appendTextLikeDelta(
        currentStreaming.content,
        contentIndex,
        contentType,
        newText,
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
    actionName,
  );
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
  if (process.env.NODE_ENV === "development") {
    const currentMessageId = useMessagingStore
      .getState()
      .getStreaming(streamKey).currentMessageId;
    // Log only a snippet to avoid too much noise.
    logger.log(
      `[DEBUG_STREAMING] handleTextDelta: Received delta: "${responseData.new_text ? responseData.new_text.substring(0, 30) + "..." : "[EMPTY_DELTA]"}", Current message ID in store: ${currentMessageId}`,
    );
    if (!currentMessageId) {
      console.warn(
        `[DEBUG_STORE] handleTextDelta: Attempted to append delta but no currentMessageId in store. Delta: "${responseData.new_text}"`,
      );
    }
  }
  applyTextLikeDelta(
    "text",
    responseData.content_index,
    responseData.new_text,
    streamKey,
    "messaging/handleTextDelta",
  );
};
