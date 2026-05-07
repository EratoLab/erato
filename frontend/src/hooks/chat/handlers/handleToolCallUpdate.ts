import { applyToolUseUpdate } from "./toolUsePartHelpers";
import { useMessagingStore } from "../store/messagingStore";


import type { MessageSubmitStreamingResponseToolCallUpdate } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * Handles the 'tool_call_update' event from the streaming API response.
 *
 * Looks up the existing `tool_use` ContentPart by `tool_call_id` and merges
 * the new status / output / progress_message into it in place. If no part
 * exists yet (out-of-order events), inserts one at `content_index`.
 */
export const handleToolCallUpdate = (
  responseData: MessageSubmitStreamingResponseToolCallUpdate & {
    message_type: "tool_call_update";
  },
  streamKey?: string,
): void => {
  if (process.env.NODE_ENV === "development") {
    console.log(
      `[DEBUG_STREAMING] handleToolCallUpdate: Tool "${responseData.tool_name}" status updated to "${responseData.status}" for message ${responseData.message_id}`,
    );
  }

  if (!responseData.message_id || !responseData.tool_call_id) {
    console.warn(
      "[DEBUG_STREAMING] handleToolCallUpdate: Missing required fields in tool call update event:",
      responseData,
    );
    return;
  }

  useMessagingStore.setState(
    (state) => {
      const resolvedStreamKey = streamKey ?? state.activeStreamKey;
      const currentStreaming =
        state.streamingByKey[resolvedStreamKey] ?? state.streaming;
      const updatedContent = applyToolUseUpdate(
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
    "messaging/handleToolCallUpdate",
  );
};
