import { useMessagingStore } from "../store/messagingStore";

import type { MessageSubmitStreamingResponseToolCallUpdate } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * Handles the 'tool_call_update' event from the streaming API response.
 *
 * This event is sent to update the status of a tool call execution by the backend.
 * The handler updates the existing tool call in the streaming state with new status,
 * output, and progress information.
 *
 * @param responseData - The tool call update data received from the streaming API
 *                       Contains the updated status, output, and progress information
 * @returns void
 */
export const handleToolCallUpdate = (
  responseData: MessageSubmitStreamingResponseToolCallUpdate & {
    message_type: "tool_call_update";
  },
): void => {
  if (process.env.NODE_ENV === "development") {
    console.log(
      `[DEBUG_STREAMING] handleToolCallUpdate: Tool "${responseData.tool_name}" status updated to "${responseData.status}" for message ${responseData.message_id}`,
    );
  }

  // Validate required fields
  if (!responseData.message_id || !responseData.tool_call_id) {
    console.warn(
      "[DEBUG_STREAMING] handleToolCallUpdate: Missing required fields in tool call update event:",
      responseData,
    );
    return;
  }

  // Update the streaming state with the tool call update
  useMessagingStore.setState((state) => {
    const existingToolCall =
      state.streaming.toolCalls[responseData.tool_call_id];

    if (process.env.NODE_ENV === "development") {
      console.log(
        `[DEBUG_STORE] handleToolCallUpdate: Updating tool call ${responseData.tool_call_id} (${responseData.tool_name}) status: ${responseData.status}`,
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        existingToolCall
          ? "Existing tool call found"
          : "Creating new tool call entry",
      );
    }

    return {
      ...state,
      streaming: {
        ...state.streaming,
        toolCalls: {
          ...state.streaming.toolCalls,
          [responseData.tool_call_id]: {
            ...existingToolCall,
            id: responseData.tool_call_id,
            name: responseData.tool_name,
            status: responseData.status,
            input: responseData.input ?? existingToolCall.input,
            output: responseData.output,
            progress_message: responseData.progress_message,
          },
        },
      },
    };
  });
};
