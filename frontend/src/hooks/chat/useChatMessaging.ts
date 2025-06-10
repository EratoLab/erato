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

import { useChatHistory } from "@/hooks";
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
import { handleToolCallProposed } from "./handlers/handleToolCallProposed";
import { handleToolCallUpdate } from "./handlers/handleToolCallUpdate";
import { handleUserMessageSaved } from "./handlers/handleUserMessageSaved";
import { useMessagingStore } from "./store/messagingStore";
import { useExplicitNavigation } from "./useExplicitNavigation";

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
    setNewlyCreatedChatIdInStore,
    setAwaitingFirstStreamChunkForNewChat,
  } = useMessagingStore();
  const sseCleanupRef = useRef<(() => void) | null>(null);
  const isSubmittingRef = useRef(false);
  // Remove pendingChatIdRef, use state instead
  // const pendingChatIdRef = useRef<string | null>(null);
  const [newlyCreatedChatId, setNewlyCreatedChatId] = useState<string | null>(
    null,
  );

  // Add explicit navigation hook
  const explicitNav = useExplicitNavigation();

  // Log hook mounting and unmounting - keep this for debugging chat lifecycle
  useEffect(() => {
    const currentChatId = chatId; // Capture chatId for cleanup
    const isInTransition =
      useMessagingStore.getState().isInNavigationTransition;

    // Only log in development
    if (process.env.NODE_ENV === "development") {
      // console.log(
      //   `[CHAT_FLOW_LIFECYCLE] useChatMessaging mounted for chatId: ${currentChatId ?? "null"}`,
      // );
      console.log(
        `[DEBUG_STREAMING] useChatMessaging mounted. chatId: ${currentChatId ?? "null"}, silentChatId: ${silentChatId ?? "null"}, isInTransition: ${isInTransition}`,
      );
    }

    // Skip state reset during navigation transition to preserve optimistic state
    if (isInTransition) {
      console.log(
        "[DEBUG_STREAMING] Skipping state reset during navigation transition to preserve optimistic state.",
      );
      return () => {
        console.log(
          `[DEBUG_STREAMING] useChatMessaging cleanup skipped during transition. chatId: ${currentChatId ?? "null"}`,
        );
      };
    }

    // CRITICAL FIX: When chatId is null (e.g., after archiving), clear ALL user messages
    // to ensure clean state. For existing chats, only clear completed messages.
    if (!currentChatId) {
      if (process.env.NODE_ENV === "development") {
        console.log(
          `[DEBUG_STORE] useChatMessaging (null chatId) effect: Clearing ALL user messages for clean state. Current userMessages count: ${Object.keys(useMessagingStore.getState().userMessages).length}`,
        );
      }
      // Clear all user messages when chatId is null (e.g., new chat or after archiving)
      useMessagingStore.getState().clearUserMessages();
    } else {
      // Only clear completed messages to preserve user messages during navigation for existing chats
      if (process.env.NODE_ENV === "development") {
        console.log(
          `[DEBUG_STORE] useChatMessaging (${currentChatId}) effect: About to call clearCompletedUserMessages. Current userMessages count: ${Object.keys(useMessagingStore.getState().userMessages).length}`,
        );
      }
      clearCompletedUserMessages();
      if (process.env.NODE_ENV === "development") {
        console.log(
          `[DEBUG_STORE] useChatMessaging (${currentChatId}) effect: Called clearCompletedUserMessages. New userMessages count: ${Object.keys(useMessagingStore.getState().userMessages).length}`,
        );
      }
    }

    // Reset streaming state
    console.log(
      "[DEBUG_STREAMING] Resetting streaming state on mount/chatId change.",
    );
    resetStreaming();

    // Reset newly created chat ID state when hook mounts/chatId changes
    console.log(
      "[DEBUG_REDIRECT] Resetting newlyCreatedChatId on mount/chatId change.",
    );
    setNewlyCreatedChatId(null);

    return () => {
      // Only log in development
      if (process.env.NODE_ENV === "development") {
        // console.log(
        //   `[CHAT_FLOW_LIFECYCLE] useChatMessaging unmounting for chatId: ${currentChatId ?? "null"}`,
        // );
        console.log(
          `[DEBUG_STREAMING] useChatMessaging unmounting. chatId: ${currentChatId ?? "null"}`,
        );
      }
    };
  }, [chatId, clearCompletedUserMessages, resetStreaming, silentChatId]); // Added silentChatId to dep array for mount log

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
  const { refetch: refetchChatHistory } = useChatHistory();

  // --- Define handleRefetchAndClear callback ---
  const handleRefetchAndClear = useCallback(
    async (options: { invalidate?: boolean; logContext: string }) => {
      const { invalidate = false, logContext } = options;

      // Don't clear optimistic state during navigation transition
      const isInTransition =
        useMessagingStore.getState().isInNavigationTransition;
      // Refetch chat message history.
      await refetchChatHistory();

      if (chatId) {
        if (process.env.NODE_ENV === "development") {
          console.log(
            `[DEBUG_STREAMING] ${logContext}, refetching for chatId: ${chatId}`,
          );
        }
        if (invalidate) {
          await queryClient.invalidateQueries({
            queryKey: ["chatMessages", { chatId }],
          });
        }
        // Ensure refetch happens before clearing messages, especially if invalidation occurred
        await chatMessagesQuery.refetch();

        // Only clear user messages during navigation transitions or new chat creation
        // For existing chats, let the merge handle deduplication naturally
        if (isInTransition) {
          console.log(
            `[DEBUG_STREAMING] ${logContext}: Skipping clearCompletedUserMessages during navigation transition`,
          );
        } else if (logContext.includes("completed") && chatId) {
          console.log(
            `[DEBUG_STREAMING] ${logContext}: Skipping clearCompletedUserMessages for existing chat to prevent message drop`,
          );
        } else {
          clearCompletedUserMessages();
        }

        if (newlyCreatedChatId && process.env.NODE_ENV === "development") {
          console.log(
            `[DEBUG_REDIRECT] ${logContext} & refetched, relevant for pending chat: ${newlyCreatedChatId}`,
          );
        }
      } else {
        if (process.env.NODE_ENV === "development") {
          console.log(
            `[DEBUG_STREAMING] ${logContext}, no active chatId for refetch.`,
          );
        }

        // Only clear user messages during navigation transitions or new chat creation
        if (isInTransition) {
          console.log(
            `[DEBUG_STREAMING] ${logContext}: Skipping clearCompletedUserMessages during navigation transition`,
          );
        } else if (logContext.includes("completed")) {
          console.log(
            `[DEBUG_STREAMING] ${logContext}: Skipping clearCompletedUserMessages for new chat completion to prevent message drop`,
          );
        } else {
          clearCompletedUserMessages();
        }

        if (newlyCreatedChatId && process.env.NODE_ENV === "development") {
          console.log(
            `[DEBUG_REDIRECT] ${logContext} (new chat without active chatId for refetch), relevant for pending chat: ${newlyCreatedChatId}`,
          );
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      chatId,
      newlyCreatedChatId,
      queryClient,
      clearCompletedUserMessages,
      refetchChatHistory,
    ],
  );
  // --- End of handleRefetchAndClear callback ---

  // For backward compatibility with tests
  const cancelMessage = useCallback(() => {
    // Don't clear optimistic state during navigation transition
    const isInTransition =
      useMessagingStore.getState().isInNavigationTransition;

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
        if (!isInTransition) {
          clearCompletedUserMessages();
        } else {
          console.log(
            "[DEBUG_STREAMING] cancelMessage: Skipping clearCompletedUserMessages during navigation transition",
          );
        }
      });
    } else {
      if (!isInTransition) {
        clearCompletedUserMessages();
      } else {
        console.log(
          "[DEBUG_STREAMING] cancelMessage: Skipping clearCompletedUserMessages during navigation transition",
        );
      }
    }

    // Reset the submission flag
    isSubmittingRef.current = false;

    // Log cancellation
    if (process.env.NODE_ENV === "development") {
      console.log(
        "[DEBUG_STREAMING] Message cancelled by calling cancelMessage.",
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetStreaming, clearCompletedUserMessages, chatId]);

  // Clean up any existing SSE connection on unmount or chatId change
  useEffect(() => {
    // console.log(
    //   `[CHAT_FLOW_LIFECYCLE_DEBUG] Setting up cleanup effect for chatId: ${chatId ?? "null"}`,
    // );
    const capturedChatIdForCleanup = chatId; // Capture chatId for the cleanup function

    return () => {
      const isInTransition =
        useMessagingStore.getState().isInNavigationTransition;

      // Skip SSE cleanup during navigation transition to preserve connection
      if (isInTransition) {
        console.log(
          `[DEBUG_STREAMING] SSE Cleanup skipped during navigation transition for chatId: ${capturedChatIdForCleanup ?? "null"}`,
        );
        return;
      }

      // console.log(
      //   `[CHAT_FLOW_LIFECYCLE_DEBUG] Running cleanup for capturedChatId: ${capturedChatIdForCleanup ?? "null"}. Current sseCleanupRef.current is ${sseCleanupRef.current ? "set" : "null"}.`,
      // );
      if (sseCleanupRef.current) {
        // console.log(
        //   `[CHAT_FLOW_LIFECYCLE_DEBUG] Calling sseCleanupRef.current() for capturedChatId: ${capturedChatIdForCleanup ?? "null"}`,
        // );
        console.log(
          `[DEBUG_STREAMING] SSE Cleanup: Closing SSE connection for chatId: ${capturedChatIdForCleanup ?? "null"}`,
        );
        sseCleanupRef.current();
        sseCleanupRef.current = null;
      } else {
        // console.log(
        //   `[CHAT_FLOW_LIFECYCLE_DEBUG] sseCleanupRef.current was null for capturedChatId: ${capturedChatIdForCleanup ?? "null"}, no cleanup call needed.`,
        // );
      }

      // Reset submission flag on unmount to prevent stale state
      console.log(
        "[DEBUG_STREAMING] SSE Cleanup: Resetting isSubmittingRef.current to false.",
      );
      isSubmittingRef.current = false;

      // Reset streaming state
      console.log("[DEBUG_STREAMING] SSE Cleanup: Calling resetStreaming.");
      resetStreaming();

      // Clear error on unmount
      console.log("[DEBUG_STREAMING] SSE Cleanup: Clearing error state.");
      setError(null);
    };
  }, [chatId, resetStreaming, setError]);

  // Combine API messages and locally added user messages
  const combinedMessages = useMemo(() => {
    // CRITICAL FIX: When chatId is null (e.g., after archiving), immediately return empty state
    // to prevent showing stale messages from the previous chat
    if (!chatId) {
      if (process.env.NODE_ENV === "development") {
        console.log(
          "[DEBUG_STREAMING] combinedMessages: chatId is null, returning empty message state to prevent stale data",
        );
      }
      return {};
    }

    const apiMsgs: Message[] =
      chatMessagesQuery.data?.messages.map(mapApiMessageToUiMessage) ?? [];

    // Convert locally stored user messages to Message[] array
    const localUserMsgs = Object.values(userMessages);

    // Use the new utility for merging messages
    const merged = mergeDisplayMessages(apiMsgs, localUserMsgs);

    if (process.env.NODE_ENV === "development" && localUserMsgs.length > 0) {
      console.log(
        "[DEBUG_STREAMING] Combined messages (using mergeDisplayMessages):",
        {
          apiMessages: apiMsgs.length,
          localMessages: localUserMsgs.length,
          finalMessages: Object.keys(merged).length,
          currentChatId: chatId,
          userMessagesState: userMessages, // Log the actual userMessages from store
        },
      );
    }
    return merged;
  }, [chatMessagesQuery.data, userMessages, chatId]);

  // Add the streaming message if it exists
  const messages = useMemo(() => {
    // If no streaming message ID, just return combined messages
    if (!streaming.currentMessageId) {
      if (process.env.NODE_ENV === "development" && streaming.isStreaming) {
        console.log(
          "[DEBUG_STREAMING] useChatMessaging messages useMemo: isStreaming is true, but currentMessageId is not yet set. Returning combinedMessages.",
          {
            streamingState: streaming,
            combinedMessagesCount: Object.keys(combinedMessages).length,
          },
        );
      }
      return combinedMessages;
    }

    // Check if the real message (with same ID) already exists in API data
    const realMessageExists: boolean =
      !!combinedMessages[streaming.currentMessageId];

    // If real message exists, don't add streaming version (API version takes precedence)
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (realMessageExists) {
      if (process.env.NODE_ENV === "development") {
        console.log(
          "[DEBUG_STREAMING] useChatMessaging messages useMemo: Real message exists in API data, using API version.",
          {
            messageId: streaming.currentMessageId,
            combinedMessagesCount: Object.keys(combinedMessages).length,
          },
        );
      }
      return combinedMessages;
    }

    // Keep showing streaming message (even if streaming completed) until real message arrives
    if (process.env.NODE_ENV === "development") {
      console.log(
        `[DEBUG_STREAMING] useChatMessaging messages useMemo: ${streaming.isStreaming ? "Actively streaming" : "Streaming completed, keeping placeholder"}. Constructing/updating streaming message.`,
        {
          streamingState: streaming,
          realMessageExists,
        },
      );
    }

    const finalMessagesRecord: Record<string, Message> = {
      ...combinedMessages,
    };

    // Add or update the streaming assistant message as placeholder
    finalMessagesRecord[streaming.currentMessageId] = {
      id: streaming.currentMessageId,
      content: streaming.content || "", // Ensure content is at least an empty string
      role: "assistant",
      createdAt: new Date().toISOString(), // This will change, but it's for a temp display
      status: streaming.isStreaming ? "sending" : "complete", // Update status when streaming completes
    };
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
          console.log(
            "[DEBUG_STREAMING] processStreamEvent: Received empty event data. Skipping.",
          );
          return;
        }

        const responseData = JSON.parse(
          event.data,
        ) as MessageSubmitStreamingResponseMessage;

        console.log(
          "[DEBUG_STREAMING] processStreamEvent: Received SSE event type:",
          responseData.message_type,
        );

        // Handle different message types from SSE
        switch (responseData.message_type) {
          case "chat_created":
            console.log(
              "[DEBUG_REDIRECT] processStreamEvent: chat_created event received. Full payload:",
              responseData,
            );
            handleChatCreated(responseData, setNewlyCreatedChatId);
            break;

          case "user_message_saved":
            console.log(
              "[DEBUG_STREAMING] processStreamEvent: user_message_saved event. Full payload:",
              responseData,
            );
            handleUserMessageSaved(responseData);
            break;

          case "assistant_message_started":
            console.log(
              "[DEBUG_STREAMING] processStreamEvent: assistant_message_started event. Full payload:",
              responseData,
            );
            handleAssistantMessageStarted(responseData);
            break;

          case "text_delta":
            // console.log("[DEBUG_STREAMING] processStreamEvent: text_delta event. Delta:", responseData.delta); // Can be too noisy
            handleTextDelta(responseData);
            break;

          case "assistant_message_completed":
            console.log(
              "[DEBUG_STREAMING] processStreamEvent: assistant_message_completed event. Full payload:",
              responseData,
            );
            // Call the new external handler to update store and trigger explicit navigation
            externalHandleMessageComplete(responseData, explicitNav);

            // Use the new utility for refetch and clear
            console.log(
              "[DEBUG_STREAMING] processStreamEvent: assistant_message_completed - calling handleRefetchAndClear.",
            );
            void handleRefetchAndClear({
              invalidate: true,
              logContext: "Assistant message completed",
            });
            break;

          case "tool_call_proposed":
            console.log(
              "[DEBUG_STREAMING] processStreamEvent: tool_call_proposed event received. Full payload:",
              responseData,
            );
            handleToolCallProposed(responseData);
            break;

          case "tool_call_update":
            console.log(
              "[DEBUG_STREAMING] processStreamEvent: tool_call_update event received. Full payload:",
              responseData,
            );
            handleToolCallUpdate(responseData);
            break;

          default:
            console.log(
              "[DEBUG_STREAMING] processStreamEvent: Received unhandled SSE message. Full payload:",
              responseData,
            );
            // No special handling needed for now
            break;
        }
      } catch (err) {
        // Keep error logging for important error cases
        console.error(
          "[DEBUG_STREAMING] Error parsing SSE data:",
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
      explicitNav, // Added explicit navigation dependency
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
        "[DEBUG_STREAMING] Using previous_message_id:",
        previousMessageId,
        "from",
        messageOrder.length, // Use messageOrder.length for logging
        "total messages in order. Current messages object:",
        messages,
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
        console.warn(
          "[DEBUG_STREAMING] Preventing duplicate message submission",
        );
        return undefined;
      }
      console.log(
        `[DEBUG_STREAMING] sendMessage called. Content: "${content}", Files: ${inputFileIds?.length ?? 0}`,
      );

      // ---> If using silentChatId, set the target navigation ID immediately <---
      if (silentChatId) {
        console.log(
          `[DEBUG_REDIRECT] sendMessage: Pre-setting newlyCreatedChatId to silentChatId: ${silentChatId}`,
        );
        setNewlyCreatedChatId(silentChatId);
        // CRITICAL: Also set the store value for navigation logic in ChatProvider
        console.log(
          `[DEBUG_REDIRECT] sendMessage: Also setting store newlyCreatedChatIdInStore to: ${silentChatId}`,
        );
        setNewlyCreatedChatIdInStore(silentChatId);
        // CRITICAL: Set awaiting flag to prevent premature navigation before streaming starts
        console.log(
          `[DEBUG_REDIRECT] sendMessage: Setting isAwaitingFirstStreamChunkForNewChat to true to delay navigation`,
        );
        setAwaitingFirstStreamChunkForNewChat(true);
      }
      // Ensure it's null otherwise before starting
      else {
        console.log(
          `[DEBUG_REDIRECT] sendMessage: Setting newlyCreatedChatId to null (no silentChatId). Current newlyCreatedChatId: ${newlyCreatedChatId}`,
        );
        setNewlyCreatedChatId(null);
        // Also clear the store value
        setNewlyCreatedChatIdInStore(null);
      }

      isSubmittingRef.current = true;
      console.log(
        "[DEBUG_STREAMING] sendMessage: isSubmittingRef.current set to true.",
      );

      // Use the new utility for creating optimistic user message
      const userMessage = createOptimisticUserMessage(content, inputFileIds);
      console.log(
        "[DEBUG_STREAMING] sendMessage: Adding optimistic user message to store:",
        userMessage,
      );
      addUserMessage(userMessage);

      if (process.env.NODE_ENV === "development") {
        // console.log(
        //   "[CHAT_FLOW] Added temporary user message:",
        //   userMessage.id,
        // );
        // console.log(
        //   `[CHAT_FLOW_LIFECYCLE_DEBUG] sendMessage called with chatId: ${chatId ?? "null"}, silentChatId: ${silentChatId ?? "null"}`,
        // );
      }

      try {
        // Reset any previous streaming state FIRST
        console.log(
          "[DEBUG_STREAMING] sendMessage: Resetting streaming state before SSE connection.",
        );
        resetStreaming();

        // Clean up any existing SSE connection
        if (sseCleanupRef.current) {
          console.log(
            "[DEBUG_STREAMING] sendMessage: Closing previous SSE connection before creating a new one.",
          );
          // console.log(
          //   `[CHAT_FLOW_LIFECYCLE_DEBUG] sendMessage: Cleaning up existing sseCleanupRef for chatId: ${chatId ?? "null"} before new connection.`,
          // );
          sseCleanupRef.current();
          sseCleanupRef.current = null;

          // Add a small delay to ensure proper cleanup
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        // Find the most recent assistant message to use as previous_message_id
        const previousMessageId = findMostRecentAssistantMessageId();
        console.log(
          `[DEBUG_STREAMING] sendMessage: Determined previousMessageId: ${previousMessageId}`,
        );

        // Use the new utility to construct the request body
        const effectiveChatIdForRequest = chatId ?? silentChatId ?? undefined;
        const requestBody = constructSubmitStreamRequestBody(
          content,
          inputFileIds,
          previousMessageId,
          effectiveChatIdForRequest,
        );

        console.log(
          "[DEBUG_STREAMING] sendMessage: Sending requestBody:",
          requestBody,
          "Effective Chat ID for request:",
          effectiveChatIdForRequest,
        );

        // Only log in development
        if (process.env.NODE_ENV === "development") {
          console.log(
            `[DEBUG_STREAMING] Creating SSE connection${
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
        // eslint-disable-next-line lingui/no-unlocalized-strings
        const sseUrl = `/api/v1beta/me/messages/submitstream`;

        // The SSE client will handle the POST request format
        // console.log(
        //   `[CHAT_FLOW_LIFECYCLE_DEBUG] sendMessage: About to call createSSEConnection for chatId: ${chatId ?? "null"}. sseCleanupRef.current is currently ${sseCleanupRef.current ? "set" : "null"}.`,
        // );
        console.log(
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          `[DEBUG_STREAMING] sendMessage: Calling createSSEConnection. Current sseCleanupRef is ${sseCleanupRef.current ? "set" : "null"}.`,
        );
        sseCleanupRef.current = createSSEConnection(sseUrl, {
          onMessage: processStreamEvent,
          onError: (errorEvent) => {
            // Use the actual event if it's an Error, otherwise create a generic one
            const connectionError =
              errorEvent instanceof Error
                ? errorEvent
                : new Error("SSE connection error");
            console.error(
              "[DEBUG_STREAMING] SSE connection error in useChatMessaging:",
              connectionError,
            );
            // Use setError from store
            setError(connectionError);

            // Reset streaming state
            console.log(
              "[DEBUG_STREAMING] SSE onError: Resetting streaming state.",
            );
            resetStreaming();

            // Use the new utility for refetch and clear
            console.log(
              "[DEBUG_STREAMING] SSE onError: Calling handleRefetchAndClear.",
            );
            void handleRefetchAndClear({ logContext: "SSE error" });

            isSubmittingRef.current = false; // Reset submission flag on error
            console.log(
              "[DEBUG_STREAMING] SSE onError: isSubmittingRef.current set to false.",
            );
          },
          onOpen: () => {
            // No action needed
            console.log(
              "[DEBUG_STREAMING] SSE connection opened via onOpen callback in useChatMessaging.",
            );
          },
          onClose: () => {
            console.log(
              "[DEBUG_STREAMING] SSE connection closed via onClose callback in useChatMessaging. isSubmittingRef.current:",
              isSubmittingRef.current,
              "streaming.isStreaming:",
              streaming.isStreaming,
            );
            isSubmittingRef.current = false;
            console.log(
              "[DEBUG_STREAMING] SSE onClose: isSubmittingRef.current set to false.",
            );

            if (!streaming.isStreaming) {
              // Use the new utility for refetch and clear
              console.log(
                "[DEBUG_STREAMING] SSE onClose: Not streaming, calling handleRefetchAndClear.",
              );
              void handleRefetchAndClear({ logContext: "SSE closed normally" });
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            } else if (streaming.isStreaming) {
              console.warn(
                "[DEBUG_STREAMING] SSE connection closed unexpectedly while streaming was still active.",
              );
              // Use setError from store
              setError(new Error("SSE connection closed unexpectedly"));

              // Reset streaming state
              console.log(
                "[DEBUG_STREAMING] SSE onClose (unexpected): Resetting streaming state.",
              );
              resetStreaming();

              // Use the new utility for refetch and clear
              console.log(
                "[DEBUG_STREAMING] SSE onClose (unexpected): Calling handleRefetchAndClear.",
              );
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
        // console.log(
        //   `[CHAT_FLOW_LIFECYCLE_DEBUG] sendMessage: Assigned new cleanup to sseCleanupRef.current for chatId: ${chatId ?? "null"}.`,
        // );
        console.log(
          `[DEBUG_STREAMING] sendMessage: Assigned new cleanup to sseCleanupRef.current.`,
        );

        // Return original value (streaming content or undefined)
        return Promise.resolve(undefined);
      } catch (error) {
        console.error(
          "[DEBUG_STREAMING] Error in sendMessage try-catch block:",
          error,
        );
        setError(
          error instanceof Error ? error : new Error("Failed to send message"),
        );

        // Reset streaming state
        console.log(
          "[DEBUG_STREAMING] sendMessage catch: Resetting streaming state.",
        );
        resetStreaming();

        // Use the new utility for refetch and clear
        console.log(
          "[DEBUG_STREAMING] sendMessage catch: Calling handleRefetchAndClear.",
        );
        void handleRefetchAndClear({ logContext: "Send message error" });

        isSubmittingRef.current = false; // Reset submission flag on error
        console.log(
          "[DEBUG_STREAMING] sendMessage catch: isSubmittingRef.current set to false.",
        );
        // Return undefined for non-successful paths
        return undefined;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      silentChatId,
      addUserMessage,
      resetStreaming,
      findMostRecentAssistantMessageId,
      chatId,
      processStreamEvent,
      setError,
      handleRefetchAndClear,
      setNewlyCreatedChatIdInStore,
      setAwaitingFirstStreamChunkForNewChat,
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
