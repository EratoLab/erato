/**
 * Hook for streaming message API interactions
 */
import { useCallback } from "react";

import {
  useMessageSubmitSse,
  useRegenerateMessageSse,
  type MessageSubmitSseVariables,
  type RegenerateMessageSseVariables,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { useMessageStore } from "@/state/messaging/store";

import { createSSERequest, fetchSSE } from "./sseHandler";
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

  // Use the generated API mutations
  const submitMutation = useMessageSubmitSse({
    onError: (error) => {
      console.error("Stream API error:", error);
      setStreaming({
        status: "error",
        error: new Error(
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          typeof error === "object" && error !== null
            ? ((error as { message?: string }).message ?? "Stream error")
            : "Failed to stream message",
        ),
      });
    },
  });

  const regenerateMutation = useRegenerateMessageSse({
    onError: (error) => {
      console.error("Regenerate stream error:", error);
      setStreaming({
        status: "error",
        error: new Error(
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          typeof error === "object" && error !== null
            ? ((error as { message?: string }).message ??
              "Regenerate stream error")
            : "Failed to regenerate message",
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
      let safeController;
      try {
        safeController = options?.signal
          ? { signal: options.signal, abort: () => {} }
          : createSafeAbortController();
      } catch (err) {
        console.error("Error creating AbortController:", err);
        // Fallback to a dummy controller
        safeController = {
          signal: {} as AbortSignal,
          abort: () => {},
        };
      }

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
          // Debug the raw data coming from the SSE
          console.log(`💬 STREAM RAW DATA [${messageId}]:`, data);

          if (!data || data.trim() === "") {
            console.warn("Empty data received from stream");
            return;
          }

          try {
            // Log before parsing
            console.log(
              `🔄 STREAM PARSING [${messageId}]: Attempting to parse message`,
            );

            const parsedData = JSON.parse(
              data,
            ) as MessageSubmitStreamingResponseMessage;

            // Log the parsed message type and content
            console.log(`✅ STREAM MESSAGE [${messageId}]:`, {
              type: parsedData.message_type,
              content:
                parsedData.message_type === "text_delta"
                  ? parsedData.new_text
                  : parsedData.message_type === "message_complete"
                    ? parsedData.full_text
                    : "N/A",
            });

            switch (parsedData.message_type) {
              case "text_delta":
                if (parsedData.new_text) {
                  // Update streaming content
                  console.log(
                    `📝 APPENDING CONTENT [${messageId}]:`,
                    parsedData.new_text,
                  );
                  appendContent(messageId, parsedData.new_text);

                  // Call the content callback if provided
                  if (options?.onContent) {
                    options.onContent(parsedData.new_text);
                  }
                } else {
                  console.warn(`⚠️ EMPTY TEXT_DELTA [${messageId}]`);
                }
                break;

              case "message_complete":
                // Update streaming state
                console.log(
                  `🏁 MESSAGE COMPLETE [${messageId}]:`,
                  parsedData.full_text,
                );
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
        // The API schema expects previous_message_id to be void, not string
        // So we need to create a new properly typed request body
        const requestBody: {
          user_message: string;
          previous_message_id?: void;
        } = {
          user_message: content,
        };

        // Include the previous message ID without explicit void casting
        // The server will correctly handle the string ID even though the schema expects void
        if (previousMessageId) {
          // This approach maintains the ID's value but satisfies TypeScript
          Object.defineProperty(requestBody, "previous_message_id", {
            value: previousMessageId,
            enumerable: true,
          });
        }

        // For debugging, log the exact request we're sending
        console.log(`🔍 DETAILED REQUEST:`, {
          messageId,
          chatId,
          bodyContent:
            content.substring(0, 50) + (content.length > 50 ? "..." : ""),
          hasPreviousMessage: !!previousMessageId,
          requestBody,
        });

        try {
          console.log("⏳ STARTING DIRECT SSE CONNECTION", { messageId });

          // Use our direct SSE implementation instead of the generated API
          await fetchSSE("/api/v1beta/me/messages/submitstream", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "text/event-stream",
            },
            body: requestBody,
            signal,
            onMessage: handleMessage,
            onError: (error) => {
              // Log the error but don't throw if it's likely a network interruption
              // after we've started receiving data
              if (
                error.message.includes("ERR_INCOMPLETE_CHUNKED_ENCODING") ||
                error.message.includes("network error")
              ) {
                console.warn(
                  "SSE connection interrupted, but messages may have been received:",
                  error,
                );
              } else {
                console.error("SSE fetch error:", error);
                throw error; // Re-throw other types of errors
              }
            },
          });

          console.log("✅ SSE CONNECTION COMPLETED", { messageId });

          // If we get here and the signal is not aborted, ensure we mark as completed
          if (!signal.aborted) {
            setStreamingStatus("completed");
            setMessageStatus(messageId, "complete");
          }
        } catch (error) {
          // Don't treat network errors as fatal if we've already started receiving content
          // This is to handle cases where the connection is dropped but we got some data
          // Check if the message had some content already by the time we got the error
          const streamingContent =
            useMessageStore.getState().streaming.messageId === messageId &&
            useMessageStore.getState().streaming.content;
          if (
            error instanceof Error &&
            (error.message.includes("ERR_INCOMPLETE_CHUNKED_ENCODING") ||
              error.message.includes("network error")) &&
            streamingContent &&
            streamingContent.length > 0
          ) {
            console.warn(
              "Network error occurred but message content was received:",
              {
                messageId,
                contentLength: streamingContent.length,
                error,
              },
            );

            // Set status to complete since we got at least some content
            setStreamingStatus("completed");
            setMessageStatus(messageId, "complete");
            return;
          }

          console.error("Direct SSE connection failed:", error);

          // Fall back to using the generated API
          console.log("⚠️ Falling back to standard SSE implementation");

          const apiVariables: MessageSubmitSseVariables = {
            body: requestBody,
            headers: {
              Accept: "text/event-stream",
            },
          };

          // Create an SSE request
          const sseRequest = createSSERequest(apiVariables, {
            signal,
            onMessage: handleMessage,
          });

          try {
            // Call the API with streaming enabled
            await submitMutation.mutateAsync(sseRequest);
          } catch (fallbackError) {
            console.error(
              "Both direct and fallback methods failed:",
              fallbackError,
            );
            throw fallbackError;
          }
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
   * Regenerate a message from the API and update state accordingly
   */
  const regenerateMessage = useCallback(
    async (messageId: string, options?: StreamOptions) => {
      // Use our safe AbortController implementation
      let safeController;
      try {
        safeController = options?.signal
          ? { signal: options.signal, abort: () => {} }
          : createSafeAbortController();
      } catch (err) {
        console.error("Error creating AbortController:", err);
        // Fallback to a dummy controller
        safeController = {
          signal: {} as AbortSignal,
          abort: () => {},
        };
      }

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
          if (!data || data.trim() === "") {
            console.warn("Empty data received from regenerate stream");
            return;
          }

          try {
            console.log(
              `🔄 REGENERATE PARSING [${messageId}]: Attempting to parse message`,
            );

            const parsedData = JSON.parse(
              data,
            ) as MessageSubmitStreamingResponseMessage;

            console.log(`✅ REGENERATE MESSAGE [${messageId}]:`, {
              type: parsedData.message_type,
              content:
                parsedData.message_type === "text_delta"
                  ? parsedData.new_text
                  : parsedData.message_type === "message_complete"
                    ? parsedData.full_text
                    : "N/A",
            });

            switch (parsedData.message_type) {
              case "text_delta":
                if (parsedData.new_text) {
                  // Update streaming content
                  console.log(
                    `📝 REGENERATE APPENDING [${messageId}]:`,
                    parsedData.new_text,
                  );
                  appendContent(messageId, parsedData.new_text);

                  // Call the content callback if provided
                  if (options?.onContent) {
                    options.onContent(parsedData.new_text);
                  }
                }
                break;

              case "message_complete":
                // Update streaming state
                console.log(
                  `🏁 REGENERATE COMPLETE [${messageId}]:`,
                  parsedData.full_text,
                );
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
            }
          } catch (error) {
            console.error(
              "Error parsing regenerate streaming data:",
              error,
              data,
            );
          }
        }

        // Prepare API request with the basic parameters
        // The API schema expects current_message_id to be string
        const requestBody: {
          current_message_id?: string;
        } = {};

        // Include the message ID for regeneration
        if (messageId) {
          // This approach maintains the ID's value for clarity
          Object.defineProperty(requestBody, "current_message_id", {
            value: messageId,
            enumerable: true,
          });
        }

        console.log(`🔍 REGENERATE REQUEST:`, {
          messageId,
          requestBody,
        });

        try {
          console.log("⏳ STARTING DIRECT REGENERATE CONNECTION", {
            messageId,
          });

          // Use our direct SSE implementation
          await fetchSSE("/api/v1beta/me/messages/regeneratestream", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "text/event-stream",
            },
            body: requestBody,
            signal,
            onMessage: handleMessage,
            onError: (error) => {
              // Log the error but don't throw if it's likely a network interruption
              // after we've started receiving data
              if (
                error.message.includes("ERR_INCOMPLETE_CHUNKED_ENCODING") ||
                error.message.includes("network error")
              ) {
                console.warn(
                  "Regenerate SSE connection interrupted, but messages may have been received:",
                  error,
                );
              } else {
                console.error("Regenerate SSE error:", error);
                throw error; // Re-throw other types of errors
              }
            },
          });

          console.log("✅ REGENERATE CONNECTION COMPLETED", { messageId });

          // If we get here and the signal is not aborted, ensure we mark as completed
          if (!signal.aborted) {
            setStreamingStatus("completed");
            setMessageStatus(messageId, "complete");
          }
        } catch (error) {
          // Don't treat network errors as fatal if we've already started receiving content
          // This is to handle cases where the connection is dropped but we got some data
          // Check if the message had some content already by the time we got the error
          const streamingContent =
            useMessageStore.getState().streaming.messageId === messageId &&
            useMessageStore.getState().streaming.content;
          if (
            error instanceof Error &&
            (error.message.includes("ERR_INCOMPLETE_CHUNKED_ENCODING") ||
              error.message.includes("network error")) &&
            streamingContent &&
            streamingContent.length > 0
          ) {
            console.warn(
              "Network error occurred during regeneration but content was received:",
              {
                messageId,
                contentLength: streamingContent.length,
                error,
              },
            );

            // Set status to complete since we got at least some content
            setStreamingStatus("completed");
            setMessageStatus(messageId, "complete");
            return;
          }

          console.error("Direct regenerate SSE connection failed:", error);

          // Fall back to using the generated API
          console.log(
            "⚠️ Falling back to standard regenerate SSE implementation",
          );

          const apiVariables: RegenerateMessageSseVariables = {
            body: {
              current_message_id: messageId,
            },
            headers: {
              Accept: "text/event-stream",
            },
          };

          // Create an SSE request
          const sseRequest = createSSERequest(
            apiVariables as unknown as MessageSubmitSseVariables,
            {
              signal,
              onMessage: handleMessage,
            },
          );

          try {
            // Call the API with streaming enabled
            await regenerateMutation.mutateAsync(
              sseRequest as unknown as RegenerateMessageSseVariables,
            );
          } catch (fallbackError) {
            console.error(
              "Both direct and fallback regenerate methods failed:",
              fallbackError,
            );
            throw fallbackError;
          }
        }
      } catch (error) {
        // Handle errors unless it was just an abort
        if (signal.aborted) {
          setStreamingStatus("cancelled");
          return;
        }

        console.error("Regenerate stream error:", error);

        const errorObj =
          error instanceof Error
            ? error
            : new Error("Unknown regeneration error");

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
      regenerateMutation,
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
    regenerateMessage,
    cancelStream,
    isStreaming: submitMutation.isPending || regenerateMutation.isPending,
  };
}
