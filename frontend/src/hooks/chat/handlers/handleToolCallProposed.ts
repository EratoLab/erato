import { useMessagingStore } from "../store/messagingStore";

import type { MessageSubmitStreamingResponseToolCallProposed } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * Handles the 'tool_call_proposed' event from the streaming API response.
 *
 * This event is sent when the LLM proposes a tool call to be part of the assistant message.
 * The handler updates the streaming state to track the proposed tool call for UI display.
 *
 * @param responseData - The tool call proposed data received from the streaming API
 *                       Contains the tool call ID, name, and input parameters
 * @returns void
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

  // Validate required fields
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

  // Update the streaming state with the proposed tool call
  useMessagingStore.setState(
    (state) => {
      const resolvedStreamKey = streamKey ?? state.activeStreamKey;
      const currentStreaming =
        state.streamingByKey[resolvedStreamKey] ?? state.streaming;
      if (process.env.NODE_ENV === "development") {
        console.log(
          `[DEBUG_STORE] handleToolCallProposed: Adding tool call ${responseData.tool_call_id} (${responseData.tool_name}) to streaming state`,
        );
      }

      return {
        ...state,
        streamingByKey: {
          ...state.streamingByKey,
          [resolvedStreamKey]: {
            ...currentStreaming,
            toolCalls: {
              ...currentStreaming.toolCalls,
              [responseData.tool_call_id]: {
                id: responseData.tool_call_id,
                name: responseData.tool_name,
                status: "proposed",
                input: responseData.input,
              },
            },
          },
        },
        streaming:
          state.activeStreamKey === resolvedStreamKey
            ? {
                ...currentStreaming,
                toolCalls: {
                  ...currentStreaming.toolCalls,
                  [responseData.tool_call_id]: {
                    id: responseData.tool_call_id,
                    name: responseData.tool_name,
                    status: "proposed",
                    input: responseData.input,
                  },
                },
              }
            : state.streaming,
      };
    },
    false,
    "messaging/handleToolCallProposed",
  );
};
