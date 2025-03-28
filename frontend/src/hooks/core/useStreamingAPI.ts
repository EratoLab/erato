/**
 * Hook for streaming message API interactions
 */
import { useCallback } from "react";

import {
  useMessageSubmitSse,
  type MessageSubmitSseVariables,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { useMessageStore } from "@/state/messaging/store";

import { createSSERequest } from "./sseHandler";
import { createSafeAbortController } from "./useAPIAdapter";

import type { MessageSubmitStreamingResponseMessage } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { StreamOptions } from "@/state/types/streaming.types";

/**
 * Custom hook for interacting with the streaming message API
 */
export function useStreamingAPI() {
  // Get message store actions
  const {
    setStreaming,
    setStreamingStatus,
    appendContent,
    setMessageStatus,
    updateMessage,
  } = useMessageStore();

  // Use the generated API mutation
  const submitMutation = useMessageSubmitSse({
    onError: (error) => {
      console.error("Stream API error:", error);
      setStreaming({
        status: "error",
        error: new Error(
          typeof error === "object" && error !== null
            ? (error as { message?: string }).message || "Stream error"
            : "Failed to stream message",
        ),
      });
    },
  });

  /**
   * Stream a message from the API and update state accordingly
   */
  const streamMessage = useCallback(
    async (
      chatId: string,
      messageId: string,
      content: string,
      previousMessageId?: string,
      _fileIds: string[] = [], // Prefix with underscore to indicate intentional non-use
      options?: StreamOptions,
    ) => {
      // Use our safe AbortController implementation
      const safeController = options?.signal
        ? { signal: options.signal, abort: () => {} }
        : createSafeAbortController();

      const signal = safeController.signal;

      // Start streaming process
      setStreaming({
        status: "connecting",
        messageId,
        content: "",
      });

      // Set the message to streaming status
      setMessageStatus(messageId, "streaming");

      try {
        // Update streaming state to active
        setStreamingStatus("active");

        // Message handler function that processes streamed data
        function handleMessage(data: string): void {
          if (!data || data.trim() === "") return;

          try {
            const parsedData = JSON.parse(
              data,
            ) as MessageSubmitStreamingResponseMessage;

            switch (parsedData.message_type) {
              case "text_delta":
                if (parsedData.new_text) {
                  // Update streaming content
                  appendContent(messageId, parsedData.new_text);

                  // Call the content callback if provided
                  if (options?.onContent) {
                    options.onContent(parsedData.new_text);
                  }
                }
                break;

              case "message_complete":
                // Update streaming state
                setStreaming({
                  status: "completed",
                  content: parsedData.full_text,
                });

                // Update the message with the final content and mark as complete
                updateMessage(messageId, {
                  content: parsedData.full_text,
                  status: "complete",
                });

                // Call the complete callback if provided
                if (options?.onComplete) {
                  options.onComplete(parsedData.full_text);
                }
                break;

              case "chat_created":
                // Just log for now, we'll handle this in a different hook
                console.log("Chat created:", parsedData.chat_id);
                break;

              case "user_message_saved":
                console.log("User message saved:", parsedData.message_id);
                break;
            }
          } catch (error) {
            console.error("Error parsing streaming data:", error, data);
          }
        }

        // Prepare API request with the basic parameters
        const apiVariables: MessageSubmitSseVariables = {
          body: {
            user_message: content,
            previous_message_id: previousMessageId || undefined,
          },
          headers: {
            Accept: "text/event-stream",
          },
        };

        // Create an SSE request that bridges the TypeScript type issues
        const sseRequest = createSSERequest(apiVariables, {
          signal,
          onMessage: handleMessage,
        });

        // Call the API with streaming enabled
        await submitMutation.mutateAsync(sseRequest);

        // If we get here and the signal is not aborted, ensure we mark as completed
        if (!signal.aborted) {
          setStreamingStatus("completed");
          setMessageStatus(messageId, "complete");
        }
      } catch (error) {
        // Handle errors unless it was just an abort
        if (signal.aborted) {
          setStreamingStatus("cancelled");
          return;
        }

        console.error("Stream error:", error);

        const errorObj =
          error instanceof Error ? error : new Error("Unknown streaming error");

        // Update streaming state
        setStreaming({
          status: "error",
          error: errorObj,
        });

        // Update message with error
        updateMessage(messageId, {
          status: "error",
          error: errorObj,
        });

        // Call error callback if provided
        if (options?.onError) {
          options.onError(errorObj);
        }
      }
    },
    [
      submitMutation,
      setStreaming,
      setStreamingStatus,
      appendContent,
      setMessageStatus,
      updateMessage,
    ],
  );

  /**
   * Cancel an active stream
   */
  const cancelStream = useCallback(
    (messageId?: string) => {
      setStreamingStatus("cancelled");

      // If a message ID is provided, mark it as complete
      if (messageId) {
        setMessageStatus(messageId, "complete");
      }
    },
    [setStreamingStatus, setMessageStatus],
  );

  return {
    streamMessage,
    cancelStream,
    isStreaming: submitMutation.isPending,
  };
}
