import { appendTextLikeDelta } from "./handleTextDelta";
import { useMessagingStore } from "../store/messagingStore";

import type { MessageSubmitStreamingResponseMessageTextDelta } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * Handles the text of a reply's spoken part: what the voice says, kept apart
 * from the written answer that streams as `text_delta`.
 */
export const handleSpokenDelta = (
  responseData: MessageSubmitStreamingResponseMessageTextDelta & {
    message_type: "spoken_delta";
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
        "spoken",
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
    "messaging/handleSpokenDelta",
  );
};
