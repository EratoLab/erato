import { insertProposedToolUse } from "./toolUsePartHelpers";
import { useMessagingStore } from "../store/messagingStore";


import type { MessageSubmitStreamingResponseToolCallProposed } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * Handles the 'tool_call_proposed' event from the streaming API response.
 *
 * Inserts a `tool_use` ContentPart into the streaming content array at the
 * event's `content_index`, so the tool call renders inline at the position
 * where the model emitted it. The wire-level proposed event carries no
 * status, so the part is seeded with `in_progress`; the next
 * `tool_call_update` will refine it.
 */
export const handleToolCallProposed = (
  responseData: MessageSubmitStreamingResponseToolCallProposed & {
    message_type: "tool_call_proposed";
  },
  streamKey?: string,
): void => {
  if (process.env.NODE_ENV === "development") {
    console.log(
      `[DEBUG_STREAMING] handleToolCallProposed: Tool "${responseData.tool_name}" proposed for message ${responseData.message_id}`,
    );
  }

  if (
    !responseData.message_id ||
    !responseData.tool_call_id ||
    !responseData.tool_name
  ) {
    console.warn(
      "[DEBUG_STREAMING] handleToolCallProposed: Missing required fields in tool call proposed event:",
      responseData,
    );
    return;
  }

  useMessagingStore.setState(
    (state) => {
      const resolvedStreamKey = streamKey ?? state.activeStreamKey;
      const currentStreaming =
        state.streamingByKey[resolvedStreamKey] ?? state.streaming;
      const updatedContent = insertProposedToolUse(
        currentStreaming.content,
        responseData,
      );

      const nextStreaming = {
        ...currentStreaming,
        content: updatedContent,
      };

      return {
        ...state,
        streamingByKey: {
          ...state.streamingByKey,
          [resolvedStreamKey]: nextStreaming,
        },
        streaming:
          state.activeStreamKey === resolvedStreamKey
            ? nextStreaming
            : state.streaming,
      };
    },
    false,
    "messaging/handleToolCallProposed",
  );
};
