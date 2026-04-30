import { appendTextLikeDelta } from "./handleTextDelta";
import { useMessagingStore } from "../store/messagingStore";

import type { MessageSubmitStreamingResponseMessageReasoningDelta } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * Handles reasoning delta events from the streaming API response.
 */
export const handleReasoningDelta = (
  responseData: MessageSubmitStreamingResponseMessageReasoningDelta & {
    message_type: "reasoning_delta";
  },
  streamKey?: string,
): void => {
  useMessagingStore.setState(
    (state) => {
      const resolvedStreamKey = streamKey ?? state.activeStreamKey;
      const currentStreaming =
        state.streamingByKey[resolvedStreamKey] ?? state.streaming;
      const updatedContent = appendTextLikeDelta(
        currentStreaming.content,
        responseData.content_index,
        "reasoning",
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
    "messaging/handleReasoningDelta",
  );
};
