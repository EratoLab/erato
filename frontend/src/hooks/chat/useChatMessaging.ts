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
import { useQueryClient, skipToken } from "@tanstack/react-query";
import { useState, useCallback, useRef, useEffect, useMemo } from "react";

import { useChatHistory } from "@/hooks";
import { BUDGET_QUERY_KEY } from "@/hooks/budget/useBudgetStatus";
import { useChatMessages } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { mapApiMessageToUiMessage } from "@/utils/adapters/messageAdapter";
import {
  createOptimisticUserMessage,
  mergeDisplayMessages,
  constructSubmitStreamRequestBody,
} from "@/utils/chat/messageUtils";
import { createLogger } from "@/utils/debugLogger";
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

const logger = createLogger("HOOK", "useChatMessaging");

// Remove onChatCreated from parameters
interface UseChatMessagingParams {
  chatId: string | null;
  // onChatCreated?: (newChatId: string) => void;
  silentChatId?: string | null;
}

/**
 * Helper function to determine the null chatId scenario and handle accordingly
 * Returns an object indicating the scenario and whether to clear/preserve messages
 */
function handleNullChatIdScenario(
  userMessages: Record<string, Message>,
  logContext: string,
): {
  scenario: "new_chat" | "post_archive";
  shouldClearMessages: boolean;
  hasLocalMessages: boolean;
} {
  const hasLocalMessages = Object.keys(userMessages).length > 0;

  if (!hasLocalMessages) {
    // After archiving scenario: no local messages, clear everything for clean state
    if (process.env.NODE_ENV === "development") {
      logger.log(
        `[DEBUG_STORE] ${logContext}: Null chatId with no local messages - post-archive scenario, clearing for clean state.`,
      );
    }
    return {
      // eslint-disable-next-line lingui/no-unlocalized-strings
      scenario: "post_archive",
      shouldClearMessages: true,
      hasLocalMessages,
    };
  } else {
    // New chat scenario: has local optimistic messages, preserve them
    if (process.env.NODE_ENV === "development") {
      logger.log(
        `[DEBUG_STORE] ${logContext}: Null chatId with local messages - new chat scenario, preserving optimistic messages. Count: ${Object.keys(userMessages).length}`,
      );
    }
    return {
      // eslint-disable-next-line lingui/no-unlocalized-strings
      scenario: "new_chat",
      shouldClearMessages: false,
      hasLocalMessages,
    };
  }
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
    setSSEAbortCallback,
  } = useMessagingStore();
  const sseCleanupRef = useRef<(() => void) | null>(null);
  const isSubmittingRef = useRef(false);
  const isUnmountingRef = useRef(false); // Track if we're unmounting to skip unnecessary refetch
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

    // Reset unmounting flag on mount
    isUnmountingRef.current = false;

    // Only log in development
    if (process.env.NODE_ENV === "development") {
      logger.log(
        `[DEBUG_STREAMING] useChatMessaging mounted. chatId: ${currentChatId ?? "null"}, silentChatId: ${silentChatId ?? "null"}, isInTransition: ${isInTransition}`,
      );
    }

    // Skip state reset during navigation transition to preserve optimistic state
    if (isInTransition) {
      logger.log(
        "[DEBUG_STREAMING] Skipping state reset during navigation transition to preserve optimistic state.",
      );
      return () => {
        // Mark unmounting even during transition
        isUnmountingRef.current = true;
        if (process.env.NODE_ENV === "development") {
          logger.log(
            `[DEBUG_STREAMING] useChatMessaging unmounting (transition). chatId: ${currentChatId ?? "null"}`,
          );
        }
      };
    }

    // CRITICAL FIX: When chatId is null, distinguish between new chat and after archiving
    // to ensure clean state. For existing chats, only clear completed messages.
    if (!currentChatId) {
      const currentUserMessages = useMessagingStore.getState().userMessages;
      const { shouldClearMessages } = handleNullChatIdScenario(
        currentUserMessages,
        // eslint-disable-next-line lingui/no-unlocalized-strings
        "useChatMessaging mount effect",
      );

      if (shouldClearMessages) {
        useMessagingStore.getState().clearUserMessages();
      }
      // Don't clear user messages for new chat scenario - let them show as optimistic UI
    } else {
      // Only clear completed messages to preserve user messages during navigation for existing chats
      if (process.env.NODE_ENV === "development") {
        logger.log(
          `[DEBUG_STORE] useChatMessaging (${currentChatId}) effect: About to call clearCompletedUserMessages. Current userMessages count: ${Object.keys(useMessagingStore.getState().userMessages).length}`,
        );
      }
      clearCompletedUserMessages();
      if (process.env.NODE_ENV === "development") {
        logger.log(
          `[DEBUG_STORE] useChatMessaging (${currentChatId}) effect: Called clearCompletedUserMessages. New userMessages count: ${Object.keys(useMessagingStore.getState().userMessages).length}`,
        );
      }
    }

    // Reset streaming state
    logger.log(
      "[DEBUG_STREAMING] Resetting streaming state on mount/chatId change.",
    );
    resetStreaming();

    // Reset newly created chat ID state when hook mounts/chatId changes
    logger.log(
      "[DEBUG_REDIRECT] Resetting newlyCreatedChatId on mount/chatId change.",
    );
    setNewlyCreatedChatId(null);

    return () => {
      // Only log in development
      if (process.env.NODE_ENV === "development") {
        logger.log(
          `[DEBUG_STREAMING] useChatMessaging unmounting. chatId: ${currentChatId ?? "null"}`,
        );
      }
    };
  }, [chatId, clearCompletedUserMessages, resetStreaming, silentChatId]); // Added silentChatId to dep array for mount log

  // Skip the query if no chatId is provided using skipToken
  // This prevents the query from being executed even if refetch() is called
  const chatMessagesQuery = useChatMessages(
    chatId ? { pathParams: { chatId } } : skipToken,
    {
      refetchOnWindowFocus: true,
    },
  );
  const { refetch: refetchChatHistory } = useChatHistory();

  // --- Define handleRefetchAndClear callback ---
  const handleRefetchAndClear = useCallback(
    async (options: { invalidate?: boolean; logContext: string }) => {
      const { invalidate = false, logContext } = options;

      // CRITICAL GUARD: Skip refetch if we're unmounting/navigating away
      // This prevents expensive 3-second timeouts when SSE callbacks fire during navigation
      if (isUnmountingRef.current) {
        return;
      }

      // Don't clear optimistic state during navigation transition
      const isInTransition =
        useMessagingStore.getState().isInNavigationTransition;
      // Refetch chat message history.
      await refetchChatHistory();

      if (chatId) {
        if (process.env.NODE_ENV === "development") {
          logger.log(
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
          logger.log(
            `[DEBUG_STREAMING] ${logContext}: Skipping clearCompletedUserMessages during navigation transition`,
          );
        } else if (logContext.includes("completed") && chatId) {
          logger.log(
            `[DEBUG_STREAMING] ${logContext}: Skipping clearCompletedUserMessages for existing chat to prevent message drop`,
          );
        } else {
          clearCompletedUserMessages();
        }

        if (newlyCreatedChatId && process.env.NODE_ENV === "development") {
          logger.log(
            `[DEBUG_REDIRECT] ${logContext} & refetched, relevant for pending chat: ${newlyCreatedChatId}`,
          );
        }
      } else {
        if (process.env.NODE_ENV === "development") {
          logger.log(
            `[DEBUG_STREAMING] ${logContext}, no active chatId for refetch.`,
          );
        }

        // Only clear user messages during navigation transitions or new chat creation
        if (isInTransition) {
          logger.log(
            `[DEBUG_STREAMING] ${logContext}: Skipping clearCompletedUserMessages during navigation transition`,
          );
        } else if (logContext.includes("completed")) {
          logger.log(
            `[DEBUG_STREAMING] ${logContext}: Skipping clearCompletedUserMessages for new chat completion to prevent message drop`,
          );
        } else {
          clearCompletedUserMessages();
        }

        if (newlyCreatedChatId && process.env.NODE_ENV === "development") {
          logger.log(
            `[DEBUG_REDIRECT] ${logContext} (new chat without active chatId for refetch), relevant for pending chat: ${newlyCreatedChatId}`,
          );
        }
      }

      // Signal that finalization is complete - frontend is now fully ready
      // Only set isFinalizing to false if this was called from message completion
      if (logContext.includes("completed")) {
        logger.log(
          `[DEBUG_STREAMING] ${logContext}: Setting isFinalizing to false and resetting streaming state - frontend fully ready`,
        );
        const { resetStreaming } = useMessagingStore.getState();
        resetStreaming(); // Reset all streaming state including currentMessageId and createdAt

        // Invalidate budget query to refresh usage/consumption data
        // TanStack Query will handle deduplication and caching automatically
        logger.log(
          `[DEBUG_STREAMING] ${logContext}: Invalidating budget query for fresh usage data`,
        );
        void queryClient.invalidateQueries({ queryKey: BUDGET_QUERY_KEY });
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
          logger.log(
            "[DEBUG_STREAMING] cancelMessage: Skipping clearCompletedUserMessages during navigation transition",
          );
        }
      });
    } else {
      if (!isInTransition) {
        clearCompletedUserMessages();
      } else {
        logger.log(
          "[DEBUG_STREAMING] cancelMessage: Skipping clearCompletedUserMessages during navigation transition",
        );
      }
    }

    // Reset the submission flag
    isSubmittingRef.current = false;

    // Log cancellation
    if (process.env.NODE_ENV === "development") {
      logger.log(
        "[DEBUG_STREAMING] Message cancelled by calling cancelMessage.",
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetStreaming, clearCompletedUserMessages, chatId]);

  // Clean up any existing SSE connection on unmount or chatId change
  useEffect(() => {
    // logger.log(
    //   `[CHAT_FLOW_LIFECYCLE_DEBUG] Setting up cleanup effect for chatId: ${chatId ?? "null"}`,
    // );
    const capturedChatIdForCleanup = chatId; // Capture chatId for the cleanup function

    return () => {
      // Mark that we're unmounting - this prevents SSE onClose from triggering expensive refetch
      isUnmountingRef.current = true;

      const isInTransition =
        useMessagingStore.getState().isInNavigationTransition;

      // Skip SSE cleanup ONLY when transitioning FROM new chat (null) TO existing chat
      // This preserves the connection when the backend returns a real chat ID
      // DO NOT skip if transitioning FROM existing chat (real ID) to anywhere else
      const isTransitioningFromNewToExisting =
        isInTransition && capturedChatIdForCleanup === null;

      if (isTransitioningFromNewToExisting) {
        logger.log(
          `[DEBUG_STREAMING] SSE Cleanup skipped during navigation transition for chatId: ${String(capturedChatIdForCleanup)}`,
        );
        return;
      }

      if (sseCleanupRef.current) {
        logger.log(
          `[DEBUG_STREAMING] SSE Cleanup: Closing SSE connection for chatId: ${String(capturedChatIdForCleanup)}`,
        );
        sseCleanupRef.current(); // This calls abort on the SSE connection
        sseCleanupRef.current = null;

        // Clear the callback from the store as well
        setSSEAbortCallback(null);
      }

      // Reset submission flag on unmount to prevent stale state
      logger.log(
        "[DEBUG_STREAMING] SSE Cleanup: Resetting isSubmittingRef.current to false.",
      );
      isSubmittingRef.current = false;

      // Reset streaming state
      logger.log("SSE Cleanup: Calling resetStreaming.");
      resetStreaming();

      // Clear error on unmount
      logger.log("SSE Cleanup: Clearing error state.");
      setError(null);
    };
  }, [chatId, resetStreaming, setError, setSSEAbortCallback]);

  // Combine API messages and locally added user messages
  const combinedMessages = useMemo(() => {
    // Convert locally stored user messages to Message[] array
    const localUserMsgs = Object.values(userMessages);

    // When chatId is null, use shared helper to determine scenario
    if (!chatId) {
      const { scenario } = handleNullChatIdScenario(
        userMessages,
        "combinedMessages",
      );

      if (scenario === "post_archive") {
        return {};
      } else {
        // New chat scenario: show optimistic user messages even without chatId
        if (process.env.NODE_ENV === "development") {
          logger.log(
            "[DEBUG_STREAMING] combinedMessages: New chat scenario with optimistic messages",
            {
              localMessages: localUserMsgs.length,
              userMessagesState: userMessages,
            },
          );
        }
        // Return only local messages for new chat
        return mergeDisplayMessages([], localUserMsgs);
      }
    }

    // Only include messages that are in the active thread when provided by API
    const apiMsgs: Message[] =
      chatMessagesQuery.data?.messages
        .map(mapApiMessageToUiMessage)
        .filter((m) => m.is_message_in_active_thread !== false) ?? [];

    // Use the new utility for merging messages
    const merged = mergeDisplayMessages(apiMsgs, localUserMsgs);

    if (process.env.NODE_ENV === "development" && localUserMsgs.length > 0) {
      const userMsgInMerged = Object.values(merged).filter(
        (m) => m.role === "user" && m.id.startsWith("temp-"),
      );
      logger.log(
        "[DEBUG_STREAMING] Combined messages (using mergeDisplayMessages):",
        {
          apiMessages: apiMsgs.length,
          localMessages: localUserMsgs.length,
          finalMessages: Object.keys(merged).length,
          tempUserMsgsInResult: userMsgInMerged.length,
          allMessageIds: Object.keys(merged),
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
        logger.log(
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
        logger.log(
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
      logger.log(
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
      content: streaming.content, // Already ContentPart[]
      role: "assistant",
      createdAt: streaming.createdAt ?? new Date().toISOString(), // Use stored timestamp for consistent ordering
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
          logger.log(
            "[DEBUG_STREAMING] processStreamEvent: Received empty event data. Skipping.",
          );
          return;
        }

        const responseData = JSON.parse(
          event.data,
        ) as MessageSubmitStreamingResponseMessage;

        logger.log(
          "[DEBUG_STREAMING] processStreamEvent: Received SSE event type:",
          responseData.message_type,
        );

        // Handle different message types from SSE
        switch (responseData.message_type) {
          case "chat_created":
            logger.log(
              "[DEBUG_REDIRECT] processStreamEvent: chat_created event received. Full payload:",
              responseData,
            );
            handleChatCreated(responseData, setNewlyCreatedChatId);
            break;

          case "user_message_saved":
            logger.log(
              "[DEBUG_STREAMING] processStreamEvent: user_message_saved event. Full payload:",
              responseData,
            );
            handleUserMessageSaved(responseData);
            break;

          case "assistant_message_started":
            logger.log(
              "[DEBUG_STREAMING] processStreamEvent: assistant_message_started event. Full payload:",
              responseData,
            );
            handleAssistantMessageStarted(responseData);
            break;

          case "text_delta":
            // logger.log("processStreamEvent: text_delta event. Delta:", responseData.delta); // Can be too noisy
            handleTextDelta(responseData);
            break;

          case "assistant_message_completed":
            logger.log(
              "[DEBUG_STREAMING] processStreamEvent: assistant_message_completed event. Full payload:",
              responseData,
            );
            // Call the new external handler to update store and trigger explicit navigation
            externalHandleMessageComplete(responseData, explicitNav);

            // Use the new utility for refetch and clear
            logger.log(
              "[DEBUG_STREAMING] processStreamEvent: assistant_message_completed - calling handleRefetchAndClear.",
            );
            void handleRefetchAndClear({
              invalidate: true,
              logContext: "Assistant message completed",
            }).then(() => {
              // Reset submission flag after refetch completes
              isSubmittingRef.current = false;
              logger.log(
                "[DEBUG_STREAMING] assistant_message_completed: isSubmittingRef.current set to false after refetch.",
              );
            });
            break;

          case "tool_call_proposed":
            logger.log(
              "[DEBUG_STREAMING] processStreamEvent: tool_call_proposed event received. Full payload:",
              responseData,
            );
            handleToolCallProposed(responseData);
            break;

          case "tool_call_update":
            logger.log(
              "[DEBUG_STREAMING] processStreamEvent: tool_call_update event received. Full payload:",
              responseData,
            );
            handleToolCallUpdate(responseData);
            break;

          default:
            logger.log(
              "[DEBUG_STREAMING] processStreamEvent: Received unhandled SSE message. Full payload:",
              responseData,
            );
            // No special handling needed for now
            break;
        }
      } catch (err) {
        // Keep error logging for important error cases
        logger.error("[DEBUG_STREAMING] Error parsing SSE data:", {
          err,
          rawData: event.data,
        });
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
      logger.log("[DEBUG_STREAMING] Using previous_message_id:", {
        previousMessageId,
        from: messageOrder.length,
        totalMessages: Object.keys(messages).length,
      });
    }

    return previousMessageId;
  }, [messages, messageOrder]); // Update dependencies

  // Send a message
  const sendMessage = useCallback(
    async (
      content: string,
      inputFileIds?: string[],
      modelId?: string,
      assistantId?: string,
    ): Promise<string | undefined> => {
      // Prevent duplicate submissions
      if (isSubmittingRef.current) {
        logger.warn(
          "[DEBUG_STREAMING] Preventing duplicate message submission",
        );
        return undefined;
      }
      logger.log(
        `[DEBUG_STREAMING] sendMessage called. Content: "${content}", Files: ${inputFileIds?.length ?? 0}, Model: ${modelId ?? "default"}, Assistant: ${assistantId ?? "none"}`,
      );

      // ---> If using silentChatId, set the target navigation ID immediately <---
      if (silentChatId) {
        logger.log(
          `[DEBUG_REDIRECT] sendMessage: Pre-setting newlyCreatedChatId to silentChatId: ${silentChatId}`,
        );
        setNewlyCreatedChatId(silentChatId);
        // CRITICAL: Also set the store value for navigation logic in ChatProvider
        logger.log(
          `[DEBUG_REDIRECT] sendMessage: Also setting store newlyCreatedChatIdInStore to: ${silentChatId}`,
        );
        setNewlyCreatedChatIdInStore(silentChatId);
        // CRITICAL: Set awaiting flag to prevent premature navigation before streaming starts
        logger.log(
          `[DEBUG_REDIRECT] sendMessage: Setting isAwaitingFirstStreamChunkForNewChat to true to delay navigation`,
        );
        setAwaitingFirstStreamChunkForNewChat(true);
      }
      // Ensure it's null otherwise before starting
      else {
        logger.log(
          `[DEBUG_REDIRECT] sendMessage: Setting newlyCreatedChatId to null (no silentChatId). Current newlyCreatedChatId: ${newlyCreatedChatId}`,
        );
        setNewlyCreatedChatId(null);
        // Also clear the store value
        setNewlyCreatedChatIdInStore(null);
      }

      isSubmittingRef.current = true;
      logger.log(
        "[DEBUG_STREAMING] sendMessage: isSubmittingRef.current set to true.",
      );

      // Use the new utility for creating optimistic user message
      const userMessage = createOptimisticUserMessage(content, inputFileIds);
      logger.log(
        "[DEBUG_STREAMING] sendMessage: Adding optimistic user message to store:",
        userMessage,
      );
      addUserMessage(userMessage);

      if (process.env.NODE_ENV === "development") {
        // logger.log(
        //   "[CHAT_FLOW] Added temporary user message:",
        //   userMessage.id,
        // );
        // logger.log(
        //   `[CHAT_FLOW_LIFECYCLE_DEBUG] sendMessage called with chatId: ${chatId ?? "null"}, silentChatId: ${silentChatId ?? "null"}`,
        // );
      }

      try {
        // Reset any previous streaming state FIRST
        logger.log(
          "[DEBUG_STREAMING] sendMessage: Resetting streaming state before SSE connection.",
        );
        resetStreaming();

        // ERMAIN-88 FIX: Create optimistic assistant placeholder immediately
        // This provides instant UI feedback while the POST request is being processed
        const optimisticAssistantId = `temp-assistant-${Date.now()}`;
        const now = new Date().toISOString();
        logger.log(
          `[DEBUG_STREAMING] sendMessage: Creating optimistic assistant placeholder immediately with ID: ${optimisticAssistantId}`,
        );
        const { setStreaming } = useMessagingStore.getState();
        setStreaming({
          isStreaming: false, // Not streaming yet - just a "thinking" placeholder
          currentMessageId: optimisticAssistantId,
          content: [],
          createdAt: now,
          isFinalizing: false,
          toolCalls: {},
        });

        // Clean up any existing SSE connection
        if (sseCleanupRef.current) {
          logger.log(
            "[DEBUG_STREAMING] sendMessage: Closing previous SSE connection before creating a new one.",
          );
          // logger.log(
          //   `[CHAT_FLOW_LIFECYCLE_DEBUG] sendMessage: Cleaning up existing sseCleanupRef for chatId: ${chatId ?? "null"} before new connection.`,
          // );
          sseCleanupRef.current();
          sseCleanupRef.current = null;

          // Add a small delay to ensure proper cleanup
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        // Find the most recent assistant message to use as previous_message_id
        const previousMessageId = findMostRecentAssistantMessageId();
        logger.log(
          `[DEBUG_STREAMING] sendMessage: Determined previousMessageId: ${previousMessageId}`,
        );

        // Use the new utility to construct the request body
        const effectiveChatIdForRequest = chatId ?? silentChatId ?? undefined;
        const requestBody = constructSubmitStreamRequestBody(
          content,
          inputFileIds,
          previousMessageId,
          effectiveChatIdForRequest,
          modelId,
          assistantId,
        );

        logger.log("[DEBUG_STREAMING] sendMessage: Sending requestBody:", {
          requestBody,
          effectiveChatIdForRequest,
        });

        // Only log in development
        if (process.env.NODE_ENV === "development") {
          logger.log(
            `[DEBUG_STREAMING] Creating SSE connection${
              chatId
                ? " (existing chat)"
                : silentChatId
                  ? " (using silent chat)"
                  : " (new chat)"
            }${silentChatId ? ` with silentChatId: ${silentChatId}` : ""}`,
          );
        }

        // Create a direct SSE connection for streaming
        // eslint-disable-next-line lingui/no-unlocalized-strings
        const sseUrl = `/api/v1beta/me/messages/submitstream`;

        // The SSE client will handle the POST request format
        // logger.log(
        //   `[CHAT_FLOW_LIFECYCLE_DEBUG] sendMessage: About to call createSSEConnection for chatId: ${chatId ?? "null"}. sseCleanupRef.current is currently ${sseCleanupRef.current ? "set" : "null"}.`,
        // );
        logger.log(
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          `[DEBUG_STREAMING] sendMessage: Calling createSSEConnection. Current sseCleanupRef is ${sseCleanupRef.current ? "set" : "null"}.`,
        );

        // Store the abort function in both the ref AND the global store
        // This allows external code (like createNewChat) to abort the connection
        sseCleanupRef.current = createSSEConnection(sseUrl, {
          onMessage: processStreamEvent,
          onError: (errorEvent) => {
            // Use the actual event if it's an Error, otherwise create a generic one
            const connectionError =
              errorEvent instanceof Error
                ? errorEvent
                : new Error("SSE connection error");
            logger.error(
              "[DEBUG_STREAMING] SSE connection error in useChatMessaging:",
              connectionError,
            );
            // Use setError from store
            setError(connectionError);

            // Reset streaming state
            logger.log(
              "[DEBUG_STREAMING] SSE onError: Resetting streaming state.",
            );
            resetStreaming();

            // Use the new utility for refetch and clear
            logger.log(
              "[DEBUG_STREAMING] SSE onError: Calling handleRefetchAndClear.",
            );
            void handleRefetchAndClear({ logContext: "SSE error" });

            isSubmittingRef.current = false; // Reset submission flag on error
            logger.log(
              "[DEBUG_STREAMING] SSE onError: isSubmittingRef.current set to false.",
            );
          },
          onOpen: () => {
            // No action needed
            logger.log(
              "[DEBUG_STREAMING] SSE connection opened via onOpen callback in useChatMessaging.",
            );
          },
          onClose: () => {
            logger.log(
              "[DEBUG_STREAMING] SSE connection closed via onClose callback in useChatMessaging.",
              {
                isSubmitting: isSubmittingRef.current,
                isStreaming: streaming.isStreaming,
              },
            );
            isSubmittingRef.current = false;
            logger.log(
              "[DEBUG_STREAMING] SSE onClose: isSubmittingRef.current set to false.",
            );

            if (!streaming.isStreaming) {
              // Use the new utility for refetch and clear
              logger.log(
                "[DEBUG_STREAMING] SSE onClose: Not streaming, calling handleRefetchAndClear.",
              );
              void handleRefetchAndClear({ logContext: "SSE closed normally" });
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            } else if (streaming.isStreaming) {
              logger.warn(
                "[DEBUG_STREAMING] SSE connection closed unexpectedly while streaming was still active.",
              );
              // Use setError from store
              setError(new Error("SSE connection closed unexpectedly"));

              // Reset streaming state
              logger.log(
                "[DEBUG_STREAMING] SSE onClose (unexpected): Resetting streaming state.",
              );
              resetStreaming();

              // Use the new utility for refetch and clear
              logger.log(
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

        // Store the abort callback in the global store so it can be called from anywhere
        // This allows createNewChat to abort streaming without needing direct access to the ref
        setSSEAbortCallback(sseCleanupRef.current);

        // logger.log(
        //   `[CHAT_FLOW_LIFECYCLE_DEBUG] sendMessage: Assigned new cleanup to sseCleanupRef.current for chatId: ${chatId ?? "null"}.`,
        // );
        logger.log(
          `[DEBUG_STREAMING] sendMessage: Assigned new cleanup to sseCleanupRef.current.`,
        );

        // Return original value (streaming content or undefined)
        return Promise.resolve(undefined);
      } catch (error) {
        logger.error(
          "[DEBUG_STREAMING] Error in sendMessage try-catch block:",
          error,
        );
        setError(
          error instanceof Error ? error : new Error("Failed to send message"),
        );

        // Reset streaming state
        logger.log(
          "[DEBUG_STREAMING] sendMessage catch: Resetting streaming state.",
        );
        resetStreaming();

        // Use the new utility for refetch and clear
        logger.log(
          "[DEBUG_STREAMING] sendMessage catch: Calling handleRefetchAndClear.",
        );
        void handleRefetchAndClear({ logContext: "Send message error" });

        isSubmittingRef.current = false; // Reset submission flag on error
        logger.log(
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
      setSSEAbortCallback,
    ],
  );

  // Edit an existing message (rerun with modified user content and optional files)
  const editMessage = useCallback(
    async (
      messageId: string,
      newContent: string,
      replaceInputFileIds?: string[],
    ): Promise<void> => {
      if (isSubmittingRef.current) {
        logger.warn("[DEBUG_STREAMING] Preventing duplicate edit submission");
        return;
      }

      // Clear any previous streaming state and close existing SSE connection
      resetStreaming();
      if (sseCleanupRef.current) {
        sseCleanupRef.current();
        sseCleanupRef.current = null;
      }

      isSubmittingRef.current = true;

      try {
        const requestBody = {
          message_id: messageId,
          replace_user_message: newContent,
          ...(replaceInputFileIds && replaceInputFileIds.length > 0
            ? { replace_input_files_ids: replaceInputFileIds }
            : {}),
        } as const;

        // eslint-disable-next-line lingui/no-unlocalized-strings
        const sseUrl = `/api/v1beta/me/messages/editstream`;
        sseCleanupRef.current = createSSEConnection(sseUrl, {
          onMessage: processStreamEvent,
          onError: (errorEvent) => {
            const connectionError =
              errorEvent instanceof Error
                ? errorEvent
                : new Error("SSE connection error (edit)");
            logger.error(
              "[DEBUG_STREAMING] SSE error in editMessage:",
              connectionError,
            );
            setError(connectionError);
            resetStreaming();
            void handleRefetchAndClear({ logContext: "SSE error (edit)" });
            isSubmittingRef.current = false;
          },
          onOpen: () => {
            // no-op
          },
          onClose: () => {
            isSubmittingRef.current = false;
            if (!streaming.isStreaming) {
              void handleRefetchAndClear({
                logContext: "Edit SSE closed normally",
              });
            } else {
              logger.warn(
                "[DEBUG_STREAMING] Edit SSE connection closed unexpectedly while streaming was still active.",
              );
              setError(new Error("SSE connection closed unexpectedly (edit)"));
              resetStreaming();
              void handleRefetchAndClear({
                logContext: "Edit SSE closed unexpectedly",
              });
            }
          },
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });

        // Store the abort callback in the global store
        setSSEAbortCallback(sseCleanupRef.current);
      } catch (err) {
        logger.error("[DEBUG_STREAMING] editMessage error:", err);
        setError(
          err instanceof Error ? err : new Error("Failed to edit message"),
        );
        resetStreaming();
        // eslint-disable-next-line lingui/no-unlocalized-strings
        void handleRefetchAndClear({ logContext: "Edit message error" });
        isSubmittingRef.current = false;
      }
    },
    [
      handleRefetchAndClear,
      processStreamEvent,
      resetStreaming,
      setError,
      setSSEAbortCallback,
      streaming.isStreaming,
    ],
  );

  // Regenerate an assistant response for an existing message
  const regenerateMessage = useCallback(
    async (currentMessageId: string): Promise<void> => {
      if (isSubmittingRef.current) {
        logger.warn(
          "[DEBUG_STREAMING] Preventing duplicate regenerate submission",
        );
        return;
      }

      // Clear any previous streaming state and close existing SSE connection
      resetStreaming();
      if (sseCleanupRef.current) {
        sseCleanupRef.current();
        sseCleanupRef.current = null;
      }

      isSubmittingRef.current = true;

      try {
        const requestBody = {
          current_message_id: currentMessageId,
        };

        // eslint-disable-next-line lingui/no-unlocalized-strings
        const sseUrl = `/api/v1beta/me/messages/regeneratestream`;
        sseCleanupRef.current = createSSEConnection(sseUrl, {
          onMessage: processStreamEvent,
          onError: (errorEvent) => {
            const connectionError =
              errorEvent instanceof Error
                ? errorEvent
                : new Error("SSE connection error (regenerate)");
            logger.error(
              "[DEBUG_STREAMING] SSE error in regenerateMessage:",
              connectionError,
            );
            setError(connectionError);
            resetStreaming();
            void handleRefetchAndClear({
              logContext: "SSE error (regenerate)",
            });
            isSubmittingRef.current = false;
          },
          onOpen: () => {
            // no-op
          },
          onClose: () => {
            isSubmittingRef.current = false;
            if (!streaming.isStreaming) {
              void handleRefetchAndClear({
                logContext: "Regenerate SSE closed normally",
              });
            } else {
              logger.warn(
                "[DEBUG_STREAMING] Regenerate SSE connection closed unexpectedly while streaming was still active.",
              );
              setError(
                new Error("SSE connection closed unexpectedly (regenerate)"),
              );
              resetStreaming();
              void handleRefetchAndClear({
                logContext: "Regenerate SSE closed unexpectedly",
              });
            }
          },
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });

        // Store the abort callback in the global store
        setSSEAbortCallback(sseCleanupRef.current);
      } catch (err) {
        logger.error("[DEBUG_STREAMING] regenerateMessage error:", err);
        setError(
          err instanceof Error
            ? err
            : new Error("Failed to regenerate message"),
        );
        resetStreaming();
        // eslint-disable-next-line lingui/no-unlocalized-strings
        void handleRefetchAndClear({ logContext: "Regenerate message error" });
        isSubmittingRef.current = false;
      }
    },
    [
      handleRefetchAndClear,
      processStreamEvent,
      resetStreaming,
      setError,
      setSSEAbortCallback,
      streaming.isStreaming,
    ],
  );

  // isPendingResponse is true from the moment send is clicked until streaming completes
  // This is different from isStreaming which only becomes true after the first chunk arrives
  const isPendingResponse = streaming.currentMessageId !== null;

  return {
    messages,
    isLoading: chatMessagesQuery.isLoading,
    isStreaming: streaming.isStreaming,
    isPendingResponse, // True immediately when send is clicked (for input disabling)
    isFinalizing: streaming.isFinalizing,
    streamingContent: streaming.content,
    error: chatMessagesQuery.error ?? error,
    sendMessage,
    editMessage,
    regenerateMessage,
    cancelMessage,
    refetch: chatMessagesQuery.refetch,
    newlyCreatedChatId,
    messageOrder, // Keep messageOrder in the return object
  };
}
