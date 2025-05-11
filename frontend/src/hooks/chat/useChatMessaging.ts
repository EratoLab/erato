/**
 * Custom hook for chat messaging
 *
 * Provides a unified interface for sending messages, handling streaming responses,
 * and managing the current chat's messages.
 *
 * This implementation uses a "temporary message + refetch" pattern:
 * 1. When a message is sent, it's immediately added to local state for display
 * 2. As streaming responses arrive, they're shown to the user
 * 3. Once streaming completes, we refetch the messages from the server
 * 4. After refetching, temporary messages are cleared to avoid duplication
 *
 * This approach eliminates the need for complex ID mapping and localStorage persistence,
 * resulting in less flickering during navigation and a more reliable message history.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useState, useCallback, useRef, useEffect, useMemo } from "react";

import { useChatMessages } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { mapApiMessageToUiMessage } from "@/utils/adapters/messageAdapter";
import {
  createOptimisticUserMessage,
  mergeDisplayMessages,
  constructSubmitStreamRequestBody,
} from "@/utils/chat/messageUtils";
import { createSSEConnection, type SSEEvent } from "@/utils/sse/sseClient";

import { handleAssistantMessageStarted } from "./handlers/handleAssistantMessageStarted";
import { handleChatCreated } from "./handlers/handleChatCreated";
import { handleMessageComplete as externalHandleMessageComplete } from "./handlers/handleMessageComplete";
import { handleTextDelta } from "./handlers/handleTextDelta";
import { handleUserMessageSaved } from "./handlers/handleUserMessageSaved";
import { useMessagingStore } from "./store/messagingStore";

import type { MessageSubmitStreamingResponseMessage } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Message } from "@/types/chat";

// Remove onChatCreated from parameters
interface UseChatMessagingParams {
  chatId: string | null;
  // onChatCreated?: (newChatId: string) => void;
  silentChatId?: string | null;
}

export function useChatMessaging(
  chatIdOrParams: string | null | UseChatMessagingParams,
  // legacyOnChatCreated?: (newChatId: string) => void, // Remove legacy param
) {
  // Support both old and new function signatures for backward compatibility
  const chatId =
    typeof chatIdOrParams === "string" || chatIdOrParams === null
      ? chatIdOrParams
      : chatIdOrParams.chatId;

  // Remove onChatCreated extraction
  // const onChatCreated =
  //   ...

  const silentChatId =
    typeof chatIdOrParams === "string" || chatIdOrParams === null
      ? null
      : chatIdOrParams.silentChatId;

  const queryClient = useQueryClient();
  const {
    streaming,
    resetStreaming,
    userMessages,
    addUserMessage,
    clearCompletedUserMessages,
    error,
    setError,
  } = useMessagingStore();
  const sseCleanupRef = useRef<(() => void) | null>(null);
  const isSubmittingRef = useRef(false);
  // Remove pendingChatIdRef, use state instead
  // const pendingChatIdRef = useRef<string | null>(null);
  const [newlyCreatedChatId, setNewlyCreatedChatId] = useState<string | null>(
    null,
  );

  // Log hook mounting and unmounting - keep this for debugging chat lifecycle
  useEffect(() => {
    const currentChatId = chatId; // Capture chatId for cleanup
    // Only log in development
    if (process.env.NODE_ENV === "development") {
      console.log(
        `[CHAT_FLOW_LIFECYCLE] useChatMessaging mounted for chatId: ${currentChatId ?? "null"}`,
      );
    }

    // Only clear completed messages to preserve user messages during navigation
    clearCompletedUserMessages();

    // Reset streaming state
    resetStreaming();

    // Reset newly created chat ID state when hook mounts/chatId changes
    setNewlyCreatedChatId(null);

    return () => {
      // Only log in development
      if (process.env.NODE_ENV === "development") {
        console.log(
          `[CHAT_FLOW_LIFECYCLE] useChatMessaging unmounting for chatId: ${currentChatId ?? "null"}`,
        );
      }
    };
  }, [chatId, clearCompletedUserMessages, resetStreaming]);

  // Skip the query if no chatId is provided
  const skipQuery = !chatId;
  const chatMessagesQuery = useChatMessages(
    skipQuery
      ? { pathParams: { chatId: "" } }
      : { pathParams: { chatId: chatId } },
    {
      enabled: !skipQuery,
      refetchOnWindowFocus: true,
    },
  );

  // --- Define handleRefetchAndClear callback ---
  const handleRefetchAndClear = useCallback(
    async (options: { invalidate?: boolean; logContext: string }) => {
      const { invalidate = false, logContext } = options;

      if (chatId) {
        if (process.env.NODE_ENV === "development") {
          console.log(
            `[CHAT_FLOW] ${logContext}, refetching for chatId: ${chatId}`,
          );
        }
        if (invalidate) {
          await queryClient.invalidateQueries({
            queryKey: ["chatMessages", { chatId }],
          });
        }
        // Ensure refetch happens before clearing messages, especially if invalidation occurred
        await chatMessagesQuery.refetch();
        clearCompletedUserMessages();
        if (newlyCreatedChatId && process.env.NODE_ENV === "development") {
          console.log(
            `[CHAT_FLOW] ${logContext} & refetched, relevant for pending chat: ${newlyCreatedChatId}`,
          );
        }
      } else {
        if (process.env.NODE_ENV === "development") {
          console.log(
            `[CHAT_FLOW] ${logContext}, no active chatId for refetch.`,
          );
        }
        clearCompletedUserMessages();
        if (newlyCreatedChatId && process.env.NODE_ENV === "development") {
          console.log(
            `[CHAT_FLOW] ${logContext} (new chat without active chatId for refetch), relevant for pending chat: ${newlyCreatedChatId}`,
          );
        }
      }
    },
    [
      chatId,
      newlyCreatedChatId,
      queryClient,
      chatMessagesQuery,
      clearCompletedUserMessages,
    ],
  );
  // --- End of handleRefetchAndClear callback ---

  // For backward compatibility with tests
  const cancelMessage = useCallback(() => {
    // Clean up any existing SSE connection
    if (sseCleanupRef.current) {
      sseCleanupRef.current();
      sseCleanupRef.current = null;
    }

    // Reset streaming state
    resetStreaming();

    // Refetch first to ensure we have latest server data before clearing messages
    if (chatId) {
      void chatMessagesQuery.refetch().then(() => {
        // Use the improved clearing method to preserve user messages during transition
        clearCompletedUserMessages();
      });
    } else {
      // If no chatId, we can use the improved clearing method
      clearCompletedUserMessages();
    }

    // Reset the submission flag
    isSubmittingRef.current = false;

    // Log cancellation
    if (process.env.NODE_ENV === "development") {
      console.log("[CHAT_FLOW] Message cancelled");
    }
  }, [resetStreaming, clearCompletedUserMessages, chatId, chatMessagesQuery]);

  // Clean up any existing SSE connection on unmount or chatId change
  useEffect(() => {
    console.log(
      `[CHAT_FLOW] Setting up cleanup for chatId: ${chatId ?? "null"}`,
    );

    return () => {
      console.log(
        `[CHAT_FLOW] Cleaning up SSE connection for chatId: ${chatId ?? "null"}`,
      );
      if (sseCleanupRef.current) {
        sseCleanupRef.current();
        sseCleanupRef.current = null;
      }

      // Reset submission flag on unmount to prevent stale state
      isSubmittingRef.current = false;

      // Reset streaming state
      resetStreaming();

      // Clear error on unmount
      setError(null);
    };
  }, [chatId, resetStreaming, setError]);

  // Combine API messages and locally added user messages
  const combinedMessages = useMemo(() => {
    const apiMsgs: Message[] =
      chatMessagesQuery.data?.messages.map(mapApiMessageToUiMessage) ?? [];

    // Convert locally stored user messages to Message[] array
    const localUserMsgs = Object.values(userMessages);

    // Use the new utility for merging messages
    const merged = mergeDisplayMessages(apiMsgs, localUserMsgs);

    if (process.env.NODE_ENV === "development" && localUserMsgs.length > 0) {
      console.log(
        "[CHAT_FLOW] Combined messages (using mergeDisplayMessages):",
        {
          apiMessages: apiMsgs.length,
          localMessages: localUserMsgs.length,
          finalMessages: Object.keys(merged).length,
        },
      );
    }
    return merged;
  }, [chatMessagesQuery.data, userMessages]);

  // Add the streaming message if it exists
  const messages = useMemo(() => {
    // Start with the combined messages object
    const finalMessagesRecord: Record<string, Message> = {
      ...combinedMessages,
    };

    if (
      streaming.isStreaming &&
      streaming.currentMessageId &&
      streaming.content
    ) {
      // Add or update the streaming message in the record
      finalMessagesRecord[streaming.currentMessageId] = {
        id: streaming.currentMessageId,
        content: streaming.content,
        role: "assistant",
        createdAt: new Date().toISOString(),
        status: "sending",
      };
    }
    return finalMessagesRecord;
  }, [combinedMessages, streaming]);

  // --- Hoist messageOrder definition here ---
  const messageOrder = useMemo(
    () =>
      Object.values(messages)
        .sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        )
        .map((m) => m.id),
    [messages],
  );
  // --- End of hoisted messageOrder ---

  // Handle incoming SSE events
  const processStreamEvent = useCallback(
    (event: SSEEvent) => {
      try {
        // Handle empty or invalid data
        if (!event.data || event.data.trim() === "") {
          return;
        }

        const responseData = JSON.parse(
          event.data,
        ) as MessageSubmitStreamingResponseMessage;

        // Handle different message types from SSE
        switch (responseData.message_type) {
          case "chat_created":
            handleChatCreated(responseData, setNewlyCreatedChatId);
            break;

          case "user_message_saved":
            handleUserMessageSaved(responseData);
            break;

          case "assistant_message_started":
            handleAssistantMessageStarted(responseData);
            break;

          case "text_delta":
            handleTextDelta(responseData);
            break;

          case "assistant_message_completed":
            // Call the new external handler to update store
            externalHandleMessageComplete(responseData);

            // Use the new utility for refetch and clear
            void handleRefetchAndClear({
              invalidate: true,
              logContext: "Assistant message completed",
            });
            break;

          default:
            // No special handling needed for now
            break;
        }
      } catch (err) {
        // Keep error logging for important error cases
        console.error(
          "[CHAT_FLOW] Error parsing SSE data:",
          err,
          "Raw data:",
          event.data,
        );
      }
    },
    [
      // Dependencies for the refetch/cleanup logic and other cases
      setNewlyCreatedChatId, // for handleChatCreated
      // External handlers (handleChatCreated, handleUserMessageSaved, etc.) are stable imports
      handleRefetchAndClear, // Added dependency
    ],
  );

  // Find the most recent assistant message ID, including temporary ones
  const findMostRecentAssistantMessageId = useCallback(() => {
    let previousMessageId: string | undefined = undefined;

    // Iterate backward through the pre-sorted messageOrder
    for (let i = messageOrder.length - 1; i >= 0; i--) {
      const messageId = messageOrder[i];
      const message = messages[messageId]; // Get message from the 'messages' record
      if (message.role === "assistant") {
        previousMessageId = messageId;
        break;
      }
    }

    // Log which message we're using as previous_message_id
    if (process.env.NODE_ENV === "development") {
      console.log(
        "[CHAT_FLOW] Using previous_message_id:",
        previousMessageId,
        "from",
        messageOrder.length, // Use messageOrder.length for logging
        "total messages in order",
      );
    }

    return previousMessageId;
  }, [messages, messageOrder]); // Update dependencies

  // Send a message
  const sendMessage = useCallback(
    async (
      content: string,
      inputFileIds?: string[],
    ): Promise<string | undefined> => {
      // Prevent duplicate submissions
      if (isSubmittingRef.current) {
        console.warn("[CHAT_FLOW] Preventing duplicate message submission");
        return undefined;
      }

      // ---> If using silentChatId, set the target navigation ID immediately <---
      if (silentChatId) {
        console.log(
          `[useChatMessaging] Pre-setting newlyCreatedChatId to silentChatId: ${silentChatId}`,
        );
        setNewlyCreatedChatId(silentChatId);
      }
      // Ensure it's null otherwise before starting
      else {
        setNewlyCreatedChatId(null);
      }

      isSubmittingRef.current = true;

      // Use the new utility for creating optimistic user message
      const userMessage = createOptimisticUserMessage(content, inputFileIds);
      addUserMessage(userMessage);

      if (process.env.NODE_ENV === "development") {
        console.log(
          "[CHAT_FLOW] Added temporary user message:",
          userMessage.id,
        );
      }

      try {
        // Reset any previous streaming state FIRST
        resetStreaming();

        // Clean up any existing SSE connection
        if (sseCleanupRef.current) {
          console.log(
            "[CHAT_FLOW] Closing previous SSE connection before creating a new one",
          );
          sseCleanupRef.current();
          sseCleanupRef.current = null;

          // Add a small delay to ensure proper cleanup
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        // Find the most recent assistant message to use as previous_message_id
        const previousMessageId = findMostRecentAssistantMessageId();

        // Use the new utility to construct the request body
        const requestBody = constructSubmitStreamRequestBody(
          content,
          inputFileIds,
          previousMessageId,
          chatId ?? silentChatId ?? undefined, // Pass the effective chat ID
        );

        console.log("[useChatMessaging] Sending requestBody:", requestBody);

        // Only log in development
        if (process.env.NODE_ENV === "development") {
          console.log(
            `[CHAT_FLOW] Creating SSE connection${
              chatId
                ? " (existing chat)"
                : silentChatId
                  ? " (using silent chat)"
                  : " (new chat)"
            }`,
            silentChatId ? ` with silentChatId: ${silentChatId}` : "",
          );
        }

        // Create a direct SSE connection for streaming
        const sseUrl = `/api/v1beta/me/messages/submitstream`;

        // The SSE client will handle the POST request format
        sseCleanupRef.current = createSSEConnection(sseUrl, {
          onMessage: processStreamEvent,
          onError: (errorEvent) => {
            // Use the actual event if it's an Error, otherwise create a generic one
            const connectionError =
              errorEvent instanceof Error
                ? errorEvent
                : new Error("SSE connection error");
            console.error("[CHAT_FLOW] SSE connection error:", connectionError);
            // Use setError from store
            setError(connectionError);

            // Reset streaming state
            resetStreaming();

            // Use the new utility for refetch and clear
            void handleRefetchAndClear({ logContext: "SSE error" });

            isSubmittingRef.current = false; // Reset submission flag on error
          },
          onOpen: () => {
            // No action needed
            console.log("[CHAT_FLOW] SSE connection opened");
          },
          onClose: () => {
            isSubmittingRef.current = false;

            if (!streaming.isStreaming) {
              // Use the new utility for refetch and clear
              void handleRefetchAndClear({ logContext: "SSE closed normally" });
            } else if (streaming.isStreaming) {
              console.warn("[CHAT_FLOW] SSE connection closed unexpectedly");
              // Use setError from store
              setError(new Error("SSE connection closed unexpectedly"));

              // Reset streaming state
              resetStreaming();

              // Use the new utility for refetch and clear
              void handleRefetchAndClear({
                logContext: "SSE closed unexpectedly",
              });
            }
          },
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        });

        // Return original value (streaming content or undefined)
        return streaming.content;
      } catch (error) {
        console.error("[CHAT_FLOW] Error in sendMessage:", error);
        setError(
          error instanceof Error ? error : new Error("Failed to send message"),
        );

        // Reset streaming state
        resetStreaming();

        // Use the new utility for refetch and clear
        void handleRefetchAndClear({ logContext: "Send message error" });

        isSubmittingRef.current = false; // Reset submission flag on error
        // Return undefined for non-successful paths
        return undefined;
      }
    },
    [
      silentChatId,
      addUserMessage,
      resetStreaming,
      findMostRecentAssistantMessageId,
      chatId,
      processStreamEvent,
      streaming.content,
      streaming.isStreaming,
      setError,
      handleRefetchAndClear,
    ],
  );

  return {
    messages,
    isLoading: chatMessagesQuery.isLoading,
    isStreaming: streaming.isStreaming,
    streamingContent: streaming.content,
    error: chatMessagesQuery.error ?? error,
    sendMessage,
    cancelMessage,
    refetch: chatMessagesQuery.refetch,
    newlyCreatedChatId,
    messageOrder, // Keep messageOrder in the return object
  };
}
