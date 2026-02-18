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
/* eslint-disable @typescript-eslint/no-unnecessary-condition */
/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable lingui/no-unlocalized-strings */
import { useQueryClient, skipToken } from "@tanstack/react-query";
import { useState, useCallback, useRef, useEffect, useMemo } from "react";

import { useChatHistory } from "@/hooks";
import { BUDGET_QUERY_KEY } from "@/hooks/budget/useBudgetStatus";
import {
  chatMessagesQuery as buildChatMessagesQuery,
  fetchChatMessages,
  useChatMessages,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { mapApiMessageToUiMessage } from "@/utils/adapters/messageAdapter";
import {
  createOptimisticUserMessage,
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
import {
  getStreamKey,
  NEW_CHAT_STREAM_KEY,
  useMessagingStore,
} from "./store/messagingStore";
import { useExplicitNavigation } from "./useExplicitNavigation";

import type {
  MessageSubmitStreamingResponseMessage,
  MessageSubmitStreamingResponseError,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Message } from "@/types/chat";

const logger = createLogger("HOOK", "useChatMessaging");
const COMPLETION_CLOSE_DEDUP_MS = 5000;
// Remove onChatCreated from parameters
interface UseChatMessagingParams {
  chatId: string | null;
  // onChatCreated?: (newChatId: string) => void;
  silentChatId?: string | null;
}

function resolveStreamAlias(
  aliases: Record<string, string>,
  key: string,
): string {
  let resolved = key;
  const visited = new Set<string>();
  while (aliases[resolved] && !visited.has(resolved)) {
    visited.add(resolved);
    resolved = aliases[resolved];
  }
  return resolved;
}

/**
 * Helper function to determine the null chatId scenario and handle accordingly
 * Returns an object indicating the scenario and whether to clear/preserve messages
 */
function handleNullChatIdScenario(
  userMessages: Record<string, Message>,
  logContext: string,
): {
  scenario: "new_chat" | "post_archive" | "navigating_back";
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
      scenario: "post_archive",
      shouldClearMessages: true,
      hasLocalMessages,
    };
  }

  // Check if any message is still "sending" - indicates actual new chat in progress
  const hasSendingMessages = Object.values(userMessages).some(
    (msg) => msg.status === "sending",
  );

  if (hasSendingMessages) {
    // New chat scenario: user waiting for response, preserve optimistic messages
    if (process.env.NODE_ENV === "development") {
      logger.log(
        `[DEBUG_STORE] ${logContext}: Null chatId with sending messages - new chat scenario, preserving optimistic messages. Count: ${Object.keys(userMessages).length}`,
      );
    }
    return {
      scenario: "new_chat",
      shouldClearMessages: false,
      hasLocalMessages,
    };
  } else {
    // Navigating back scenario: all messages complete, user returned to landing page
    // Clear messages for clean state (they'll be fetched when user opens that chat)
    if (process.env.NODE_ENV === "development") {
      logger.log(
        `[DEBUG_STORE] ${logContext}: Null chatId with completed messages - navigating back scenario, clearing stale state. Count: ${Object.keys(userMessages).length}`,
      );
    }
    return {
      scenario: "navigating_back",
      shouldClearMessages: true,
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
  const streamKey = useMemo(
    () => getStreamKey(chatId ?? silentChatId),
    [chatId, silentChatId],
  );

  const queryClient = useQueryClient();
  const newlyCreatedChatIdInStore = useMessagingStore(
    (state) => state.newlyCreatedChatId,
  );
  const renderStreamKey = useMemo(
    () => (chatId ? streamKey : getStreamKey(newlyCreatedChatIdInStore)),
    [chatId, newlyCreatedChatIdInStore, streamKey],
  );
  const streaming = useMessagingStore((state) =>
    state.getStreaming(renderStreamKey),
  );
  const resetStreaming = useMessagingStore((state) => state.resetStreaming);
  const userMessages = useMessagingStore((state) =>
    state.getUserMessages(renderStreamKey),
  );
  const addUserMessage = useMessagingStore((state) => state.addUserMessage);
  const clearCompletedUserMessages = useMessagingStore(
    (state) => state.clearCompletedUserMessages,
  );
  const apiMessagesForRenderStream = useMessagingStore((state) =>
    state.getApiMessages(renderStreamKey),
  );
  const getRenderableMessages = useMessagingStore(
    (state) => state.getRenderableMessages,
  );
  const setApiMessages = useMessagingStore((state) => state.setApiMessages);
  const error = useMessagingStore((state) => state.error);
  const setError = useMessagingStore((state) => state.setError);
  const setNewlyCreatedChatIdInStore = useMessagingStore(
    (state) => state.setNewlyCreatedChatIdInStore,
  );
  const setAwaitingFirstStreamChunkForNewChat = useMessagingStore(
    (state) => state.setAwaitingFirstStreamChunkForNewChat,
  );
  const isAwaitingFirstStreamChunkForNewChat = useMessagingStore(
    (state) => state.isAwaitingFirstStreamChunkForNewChat,
  );
  const setSSEAbortCallback = useMessagingStore(
    (state) => state.setSSEAbortCallback,
  );
  const setActiveStreamKey = useMessagingStore(
    (state) => state.setActiveStreamKey,
  );
  const sseCleanupRefsRef = useRef<Record<string, () => void>>({});
  const isSubmittingByKeyRef = useRef<Record<string, boolean>>({});
  const recentlyCompletedByKeyRef = useRef<Record<string, number>>({});
  const lastResumeAttemptedChatIdRef = useRef<string | null>(null);
  const isUnmountingRef = useRef(false); // Track if we're unmounting to skip unnecessary refetch
  // Remove pendingChatIdRef, use state instead
  // const pendingChatIdRef = useRef<string | null>(null);
  const [newlyCreatedChatId, setNewlyCreatedChatId] = useState<string | null>(
    null,
  );
  const isSubmittingForKey = useCallback(
    (key: string) => isSubmittingByKeyRef.current[key] === true,
    [],
  );
  const setSubmittingForKey = useCallback((key: string, value: boolean) => {
    if (value) {
      isSubmittingByKeyRef.current[key] = true;
    } else {
      delete isSubmittingByKeyRef.current[key];
    }
  }, []);
  const getSSECleanupForKey = useCallback(
    (key: string) => sseCleanupRefsRef.current[key] ?? null,
    [],
  );
  const setSSECleanupForKey = useCallback(
    (key: string, cleanup: (() => void) | null) => {
      if (cleanup) {
        sseCleanupRefsRef.current[key] = cleanup;
      } else {
        delete sseCleanupRefsRef.current[key];
      }
    },
    [],
  );

  // Add explicit navigation hook
  const explicitNav = useExplicitNavigation();

  // Log hook mounting and unmounting - keep this for debugging chat lifecycle
  useEffect(() => {
    const currentChatId = chatId; // Capture chatId for cleanup
    const isInTransition =
      useMessagingStore.getState().isInNavigationTransition;
    setActiveStreamKey(streamKey);

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
      const currentUserMessages = useMessagingStore
        .getState()
        .getUserMessages(renderStreamKey);
      const { shouldClearMessages } = handleNullChatIdScenario(
        currentUserMessages,

        "useChatMessaging mount effect",
      );
      const isNewChatTransitionInProgress =
        !!useMessagingStore.getState().newlyCreatedChatId ||
        useMessagingStore.getState().isAwaitingFirstStreamChunkForNewChat ||
        useMessagingStore.getState().getStreaming(renderStreamKey)
          .currentMessageId !== null;

      if (shouldClearMessages && !isNewChatTransitionInProgress) {
        useMessagingStore.getState().clearUserMessages(renderStreamKey);
      }
      // Don't clear user messages for new chat scenario - let them show as optimistic UI
    } else {
      const hasActiveStreamForKey =
        useMessagingStore.getState().getStreaming(streamKey)
          .currentMessageId !== null;
      // Only clear completed messages to preserve user messages during navigation for existing chats
      if (process.env.NODE_ENV === "development") {
        logger.log(
          `[DEBUG_STORE] useChatMessaging (${currentChatId}) effect: About to call clearCompletedUserMessages. Current userMessages count: ${Object.keys(useMessagingStore.getState().getUserMessages(streamKey)).length}`,
        );
      }
      if (!hasActiveStreamForKey) {
        clearCompletedUserMessages(streamKey);
      } else {
        logger.log(
          `[DEBUG_STORE] useChatMessaging (${currentChatId}) effect: Skipping clearCompletedUserMessages because stream is active for key ${streamKey}.`,
        );
      }
      if (process.env.NODE_ENV === "development") {
        logger.log(
          `[DEBUG_STORE] useChatMessaging (${currentChatId}) effect: Called clearCompletedUserMessages. New userMessages count: ${Object.keys(useMessagingStore.getState().getUserMessages(streamKey)).length}`,
        );
      }
    }

    const existingStreaming = useMessagingStore
      .getState()
      .getStreaming(streamKey);
    if (existingStreaming.currentMessageId === null) {
      // Reset streaming state only when there is no active keyed stream to preserve.
      logger.log(
        "[DEBUG_STREAMING] Resetting streaming state on mount/chatId change.",
      );
      resetStreaming(streamKey);
    } else {
      logger.log(
        `[DEBUG_STREAMING] Preserving existing streaming state for streamKey: ${streamKey}`,
      );
    }

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
  }, [
    chatId,
    clearCompletedUserMessages,
    resetStreaming,
    silentChatId,
    setActiveStreamKey,
    streamKey,
  ]); // Added silentChatId to dep array for mount log

  // Skip the query if no chatId is provided using skipToken
  // This prevents the query from being executed even if refetch() is called
  const chatMessagesQuery = useChatMessages(
    chatId ? { pathParams: { chatId } } : skipToken,
    {
      refetchOnWindowFocus: true,
    },
  );
  const { refetch: refetchChatHistory } = useChatHistory();

  useEffect(() => {
    if (!chatId || !chatMessagesQuery.data) {
      return;
    }
    const apiMessages =
      chatMessagesQuery.data.messages
        .map(mapApiMessageToUiMessage)
        .filter((message) => message.is_message_in_active_thread !== false) ??
      [];
    setApiMessages(apiMessages, streamKey);
  }, [chatId, chatMessagesQuery.data, setApiMessages, streamKey]);

  // --- Define handleRefetchAndClear callback ---
  const handleRefetchAndClear = useCallback(
    async (options: { invalidate?: boolean; logContext: string }) => {
      const { invalidate = false, logContext } = options;
      let refetchedApiMessages: Message[] | null = null;
      const storeSnapshot = useMessagingStore.getState();
      const aliasResolvedNewChatKey = resolveStreamAlias(
        storeSnapshot.streamKeyAliases,
        NEW_CHAT_STREAM_KEY,
      );
      const aliasDerivedChatId =
        aliasResolvedNewChatKey !== NEW_CHAT_STREAM_KEY
          ? aliasResolvedNewChatKey
          : null;
      const activeResolvedKey = resolveStreamAlias(
        storeSnapshot.streamKeyAliases,
        storeSnapshot.activeStreamKey,
      );
      const activeDerivedChatId =
        activeResolvedKey !== NEW_CHAT_STREAM_KEY ? activeResolvedKey : null;
      const effectiveChatId =
        chatId ??
        newlyCreatedChatId ??
        storeSnapshot.newlyCreatedChatId ??
        aliasDerivedChatId ??
        activeDerivedChatId;
      const effectiveStreamKey = getStreamKey(effectiveChatId);
      if (process.env.NODE_ENV === "development") {
        console.log(
          `[DEBUG_STREAMING] handleRefetchAndClear: context="${logContext}" invalidate=${String(invalidate)} chatId=${chatId ?? "null"} newlyCreatedChatId(state)=${newlyCreatedChatId ?? "null"} newlyCreatedChatId(store)=${storeSnapshot.newlyCreatedChatId ?? "null"} aliasDerivedChatId=${aliasDerivedChatId ?? "null"} activeDerivedChatId=${activeDerivedChatId ?? "null"} effectiveChatId=${effectiveChatId ?? "null"} streamKey=${effectiveStreamKey}`,
        );
      }

      // Don't clear optimistic state during navigation transition
      const isInTransition =
        useMessagingStore.getState().isInNavigationTransition;
      // Refetch chat message history.
      await refetchChatHistory();

      if (effectiveChatId) {
        if (process.env.NODE_ENV === "development") {
          logger.log(
            `[DEBUG_STREAMING] ${logContext}, refetching for chatId: ${effectiveChatId}`,
          );
        }
        const chatMessagesQueryKey = buildChatMessagesQuery({
          pathParams: { chatId: effectiveChatId },
        }).queryKey;
        const queryStateBefore =
          queryClient.getQueryState(chatMessagesQueryKey);
        if (process.env.NODE_ENV === "development") {
          console.log(
            `[DEBUG_RQ] ${logContext}: before invalidate key=${JSON.stringify(chatMessagesQueryKey)} state=${JSON.stringify(
              {
                status: queryStateBefore?.status ?? null,
                fetchStatus: queryStateBefore?.fetchStatus ?? null,
                isInvalidated: queryStateBefore?.isInvalidated ?? null,
                dataUpdatedAt: queryStateBefore?.dataUpdatedAt ?? null,
              },
            )}`,
          );
        }

        // Always mark message query stale before refetch to avoid cache short-circuiting
        // when close/completion events race with React Query dedupe logic.
        await queryClient.invalidateQueries({
          queryKey: chatMessagesQueryKey,
          exact: true,
          refetchType: "none",
        });
        const queryStateAfterInvalidate =
          queryClient.getQueryState(chatMessagesQueryKey);
        if (process.env.NODE_ENV === "development") {
          console.log(
            `[DEBUG_RQ] ${logContext}: after invalidate key=${JSON.stringify(chatMessagesQueryKey)} state=${JSON.stringify(
              {
                status: queryStateAfterInvalidate?.status ?? null,
                fetchStatus: queryStateAfterInvalidate?.fetchStatus ?? null,
                isInvalidated: queryStateAfterInvalidate?.isInvalidated ?? null,
                dataUpdatedAt: queryStateAfterInvalidate?.dataUpdatedAt ?? null,
              },
            )}`,
          );
        }

        if (
          invalidate ||
          logContext.includes("closed") ||
          logContext.includes("completed")
        ) {
          await queryClient.cancelQueries({
            queryKey: chatMessagesQueryKey,
            exact: true,
          });
          const queryStateAfterCancel =
            queryClient.getQueryState(chatMessagesQueryKey);
          if (process.env.NODE_ENV === "development") {
            console.log(
              `[DEBUG_RQ] ${logContext}: after cancel key=${JSON.stringify(chatMessagesQueryKey)} state=${JSON.stringify(
                {
                  status: queryStateAfterCancel?.status ?? null,
                  fetchStatus: queryStateAfterCancel?.fetchStatus ?? null,
                  isInvalidated: queryStateAfterCancel?.isInvalidated ?? null,
                  dataUpdatedAt: queryStateAfterCancel?.dataUpdatedAt ?? null,
                },
              )}`,
            );
          }
        }

        // Force a network fetch for completion/close paths, even when current hook chatId is null.
        const refetchResult = await fetchChatMessages({
          pathParams: { chatId: effectiveChatId },
        });

        // Push fetched result into React Query cache to keep observers in sync
        // without issuing another network request.
        queryClient.setQueryData(chatMessagesQueryKey, refetchResult);
        const queryStateAfterSetData =
          queryClient.getQueryState(chatMessagesQueryKey);
        if (process.env.NODE_ENV === "development") {
          console.log(
            `[DEBUG_RQ] ${logContext}: after setQueryData key=${JSON.stringify(chatMessagesQueryKey)} state=${JSON.stringify(
              {
                status: queryStateAfterSetData?.status ?? null,
                fetchStatus: queryStateAfterSetData?.fetchStatus ?? null,
                isInvalidated: queryStateAfterSetData?.isInvalidated ?? null,
                dataUpdatedAt: queryStateAfterSetData?.dataUpdatedAt ?? null,
              },
            )}`,
          );
        }

        refetchedApiMessages =
          refetchResult.messages
            .map(mapApiMessageToUiMessage)
            .filter(
              (message) => message.is_message_in_active_thread !== false,
            ) ?? null;
        if (refetchedApiMessages) {
          setApiMessages(refetchedApiMessages, effectiveStreamKey);
        }

        // Only clear user messages during navigation transitions or new chat creation
        // For existing chats, let the merge handle deduplication naturally
        if (isInTransition) {
          logger.log(
            `[DEBUG_STREAMING] ${logContext}: Skipping clearCompletedUserMessages during navigation transition`,
          );
        } else if (logContext.includes("completed") && effectiveChatId) {
          logger.log(
            `[DEBUG_STREAMING] ${logContext}: Skipping clearCompletedUserMessages for existing chat to prevent message drop`,
          );
        } else {
          clearCompletedUserMessages(effectiveStreamKey);
        }

        if (newlyCreatedChatId && process.env.NODE_ENV === "development") {
          logger.log(
            `[DEBUG_REDIRECT] ${logContext} & refetched, relevant for pending chat: ${newlyCreatedChatId}`,
          );
        }
      } else {
        if (process.env.NODE_ENV === "development") {
          logger.log(
            `[DEBUG_STREAMING] ${logContext}, no active chatId available for refetch. effectiveChatId=${effectiveChatId ?? "null"} streamKey=${effectiveStreamKey}`,
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
          clearCompletedUserMessages(effectiveStreamKey);
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
        const store = useMessagingStore.getState();
        const completionStreaming = store.getStreaming(effectiveStreamKey);
        const completionMessageId = completionStreaming.currentMessageId;
        const persistedMessagesById = store.getApiMessages(effectiveStreamKey);
        const hasPersistedCompletionMessage =
          !!completionMessageId &&
          (persistedMessagesById[completionMessageId] !== undefined ||
            refetchedApiMessages?.some(
              (message) => message.id === completionMessageId,
            ) === true);

        if (hasPersistedCompletionMessage || !completionMessageId) {
          logger.log(
            `[DEBUG_STREAMING] ${logContext}: Persisted assistant detected, resetting streaming state.`,
          );
          store.resetStreaming(effectiveStreamKey);
        } else {
          logger.log(
            `[DEBUG_STREAMING] ${logContext}: Persisted assistant not yet available, keeping completed streaming message visible.`,
          );
          store.setStreaming(
            {
              isStreaming: false,
              isFinalizing: false,
            },
            effectiveStreamKey,
          );
        }

        // Invalidate budget query to refresh usage/consumption data
        // TanStack Query will handle deduplication and caching automatically
        logger.log(
          `[DEBUG_STREAMING] ${logContext}: Invalidating budget query for fresh usage data`,
        );
        void queryClient.invalidateQueries({ queryKey: BUDGET_QUERY_KEY });
      }
    },

    [
      chatId,
      newlyCreatedChatId,
      queryClient,
      clearCompletedUserMessages,
      refetchChatHistory,
      setApiMessages,
      streamKey,
    ],
  );
  // --- End of handleRefetchAndClear callback ---

  // For backward compatibility with tests
  const cancelMessage = useCallback(() => {
    // Don't clear optimistic state during navigation transition
    const isInTransition =
      useMessagingStore.getState().isInNavigationTransition;

    // Clean up any existing SSE connection
    const cleanupForStreamKey = getSSECleanupForKey(streamKey);
    if (cleanupForStreamKey) {
      cleanupForStreamKey();
      setSSECleanupForKey(streamKey, null);
    }

    // Reset streaming state
    resetStreaming(streamKey);

    // Refetch first to ensure we have latest server data before clearing messages
    if (chatId) {
      void chatMessagesQuery.refetch().then(() => {
        if (!isInTransition) {
          clearCompletedUserMessages(streamKey);
        } else {
          logger.log(
            "[DEBUG_STREAMING] cancelMessage: Skipping clearCompletedUserMessages during navigation transition",
          );
        }
      });
    } else {
      if (!isInTransition) {
        clearCompletedUserMessages(streamKey);
      } else {
        logger.log(
          "[DEBUG_STREAMING] cancelMessage: Skipping clearCompletedUserMessages during navigation transition",
        );
      }
    }

    // Reset the submission flag
    setSubmittingForKey(streamKey, false);

    // Log cancellation
    if (process.env.NODE_ENV === "development") {
      logger.log(
        "[DEBUG_STREAMING] Message cancelled by calling cancelMessage.",
      );
    }
  }, [
    resetStreaming,
    clearCompletedUserMessages,
    chatId,
    streamKey,
    getSSECleanupForKey,
    setSSECleanupForKey,
  ]);

  // Clean up any existing SSE connection on unmount or chatId change
  useEffect(() => {
    // logger.log(
    //   `[CHAT_FLOW_LIFECYCLE_DEBUG] Setting up cleanup effect for chatId: ${chatId ?? "null"}`,
    // );
    const capturedChatIdForCleanup = chatId; // Capture chatId for the cleanup function

    return () => {
      const isInTransition =
        useMessagingStore.getState().isInNavigationTransition;
      const store = useMessagingStore.getState();

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

      const hasActiveStreamForKey =
        !!store.sseAbortCallbacksByKey[streamKey] ||
        store.getStreaming(streamKey).currentMessageId !== null;
      if (hasActiveStreamForKey) {
        logger.log(
          `[DEBUG_STREAMING] SSE Cleanup skipped to preserve active stream for streamKey: ${streamKey}`,
        );
        return;
      }

      const cleanupForStreamKey = getSSECleanupForKey(streamKey);
      if (cleanupForStreamKey) {
        logger.log(
          `[DEBUG_STREAMING] SSE Cleanup: Closing SSE connection for chatId: ${String(capturedChatIdForCleanup)}`,
        );
        cleanupForStreamKey(); // This calls abort on the SSE connection
        setSSECleanupForKey(streamKey, null);

        // Clear the callback from the store as well
        setSSEAbortCallback(null, streamKey);
      }

      // Reset submission flag on unmount to prevent stale state
      logger.log(
        "[DEBUG_STREAMING] SSE Cleanup: Resetting isSubmittingRef.current to false.",
      );
      setSubmittingForKey(streamKey, false);

      // Reset streaming state
      logger.log("SSE Cleanup: Calling resetStreaming.");
      resetStreaming(streamKey);

      // Clear error on unmount
      logger.log("SSE Cleanup: Clearing error state.");
      setError(null);
    };
  }, [
    chatId,
    resetStreaming,
    setError,
    setSSEAbortCallback,
    streamKey,
    getSSECleanupForKey,
    setSSECleanupForKey,
  ]);

  const messages = useMemo(() => {
    if (!chatId) {
      const isNewChatTransitionInProgress =
        !!newlyCreatedChatIdInStore ||
        streaming.currentMessageId !== null ||
        isAwaitingFirstStreamChunkForNewChat;
      if (isNewChatTransitionInProgress) {
        return getRenderableMessages(renderStreamKey, {
          includeApiMessages: false,
        });
      }
      const { scenario } = handleNullChatIdScenario(
        userMessages,
        "store-rendered-messages",
      );
      if (scenario === "post_archive" || scenario === "navigating_back") {
        return {};
      }
      return getRenderableMessages(renderStreamKey, {
        includeApiMessages: false,
      });
    }
    return getRenderableMessages(renderStreamKey, { includeApiMessages: true });
  }, [
    apiMessagesForRenderStream,
    chatId,
    getRenderableMessages,
    isAwaitingFirstStreamChunkForNewChat,
    newlyCreatedChatIdInStore,
    renderStreamKey,
    streaming,
    userMessages,
  ]);

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

  const isStreamCurrentlyActive = useCallback((targetStreamKey: string) => {
    return useMessagingStore.getState().getStreaming(targetStreamKey)
      .isStreaming;
  }, []);

  // Handle incoming SSE events
  const processStreamEvent = useCallback(
    (event: SSEEvent, streamKeyRef?: { current: string }) => {
      try {
        const activeStreamKey = streamKeyRef?.current ?? streamKey;
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
            {
              const previousStreamKey = activeStreamKey;
              handleChatCreated(
                responseData,
                setNewlyCreatedChatId,
                previousStreamKey,
              );

              if (
                responseData.chat_id &&
                previousStreamKey !== responseData.chat_id
              ) {
                const existingCleanup = getSSECleanupForKey(previousStreamKey);
                if (existingCleanup) {
                  setSSECleanupForKey(previousStreamKey, null);
                  setSSECleanupForKey(responseData.chat_id, existingCleanup);
                  setSSEAbortCallback(existingCleanup, responseData.chat_id);
                }
                if (streamKeyRef) {
                  streamKeyRef.current = responseData.chat_id;
                }
                if (isSubmittingForKey(previousStreamKey)) {
                  setSubmittingForKey(previousStreamKey, false);
                  setSubmittingForKey(responseData.chat_id, true);
                }

                // Navigate as soon as chat is created, not after stream completion.
                if (
                  explicitNav.currentAssistantId &&
                  explicitNav.shouldNavigateFromAssistant(responseData.chat_id)
                ) {
                  explicitNav.navigateToAssistantChat(
                    explicitNav.currentAssistantId,
                    responseData.chat_id,
                    "chat_created",
                  );
                } else if (
                  explicitNav.shouldNavigateFromNewChat(responseData.chat_id)
                ) {
                  explicitNav.performNavigation(
                    responseData.chat_id,
                    "chat_created",
                  );
                }
              }
            }
            break;

          case "user_message_saved":
            logger.log(
              "[DEBUG_STREAMING] processStreamEvent: user_message_saved event. Full payload:",
              responseData,
            );
            handleUserMessageSaved(responseData, activeStreamKey);
            break;

          case "assistant_message_started":
            logger.log(
              "[DEBUG_STREAMING] processStreamEvent: assistant_message_started event. Full payload:",
              responseData,
            );
            handleAssistantMessageStarted(responseData, activeStreamKey);
            break;

          case "text_delta":
            // logger.log("processStreamEvent: text_delta event. Delta:", responseData.delta); // Can be too noisy
            handleTextDelta(responseData, activeStreamKey);
            break;

          case "assistant_message_completed":
            logger.log(
              "[DEBUG_STREAMING] processStreamEvent: assistant_message_completed event. Full payload:",
              responseData,
            );
            // Call the new external handler to update store and trigger explicit navigation
            externalHandleMessageComplete(
              responseData,
              activeStreamKey,
              explicitNav,
            );

            // Use the new utility for refetch and clear
            logger.log(
              "[DEBUG_STREAMING] processStreamEvent: assistant_message_completed - calling handleRefetchAndClear.",
            );
            recentlyCompletedByKeyRef.current[activeStreamKey] = Date.now();
            void handleRefetchAndClear({
              invalidate: true,
              logContext: "Assistant message completed",
            }).then(() => {
              // Reset submission flag after refetch completes
              setSubmittingForKey(activeStreamKey, false);
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
            handleToolCallProposed(responseData, activeStreamKey);
            break;

          case "tool_call_update":
            logger.log(
              "[DEBUG_STREAMING] processStreamEvent: tool_call_update event received. Full payload:",
              responseData,
            );
            handleToolCallUpdate(responseData, activeStreamKey);
            break;

          case "error": {
            const streamError =
              responseData as MessageSubmitStreamingResponseError & {
                message_type: "error";
              };
            const description =
              streamError.error_description || "Streaming error";
            logger.error(
              "[DEBUG_STREAMING] processStreamEvent: stream error received.",
              streamError,
            );

            setError(new Error(description));
            resetStreaming(activeStreamKey);
            setSubmittingForKey(activeStreamKey, false);
            void handleRefetchAndClear({
              logContext: `Stream error event (${streamError.error_type})`,
            });
            break;
          }

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
      setError,
      resetStreaming,
      streamKey,
      getSSECleanupForKey,
      setSSECleanupForKey,
      setSSEAbortCallback,
      setSubmittingForKey,
      isSubmittingForKey,
    ],
  );

  useEffect(() => {
    if (!chatId) {
      lastResumeAttemptedChatIdRef.current = null;
      return;
    }

    if (lastResumeAttemptedChatIdRef.current === chatId) {
      return;
    }
    lastResumeAttemptedChatIdRef.current = chatId;

    const store = useMessagingStore.getState();
    const hasExistingConnection = !!store.sseAbortCallbacksByKey[chatId];
    if (hasExistingConnection) {
      return;
    }

    logger.log(`[DEBUG_STREAMING] Attempting resumestream for chat ${chatId}`);
    const resumeStreamKeyRef = { current: chatId };
    const cleanup = createSSEConnection(
      "/api/v1beta/me/messages/resumestream",
      {
        method: "POST",
        body: JSON.stringify({ chat_id: chatId }),
        onMessage: (sseEvent) =>
          processStreamEvent(sseEvent, resumeStreamKeyRef),
        onError: (errorEvent) => {
          const errorMessage =
            (errorEvent as Event & { error?: Error }).error?.message ??
            "SSE resume connection error";
          if (!errorMessage.includes("404")) {
            logger.error("[DEBUG_STREAMING] resumestream error:", errorMessage);
          } else {
            logger.log(
              `[DEBUG_STREAMING] resumestream unavailable for ${chatId} (no active task)`,
            );
          }
          setSSECleanupForKey(chatId, null);
          setSSEAbortCallback(null, chatId);
        },
        onClose: () => {
          logger.log(
            `[DEBUG_STREAMING] resumestream closed for chat ${chatId}`,
          );
          setSSECleanupForKey(chatId, null);
          setSSEAbortCallback(null, chatId);
        },
      },
    );

    setSSECleanupForKey(chatId, cleanup);
    setSSEAbortCallback(cleanup, chatId);
  }, [chatId, processStreamEvent, setSSEAbortCallback, setSSECleanupForKey]);

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
      selectedFacetIds?: string[],
    ): Promise<string | undefined> => {
      // Prevent duplicate submissions
      if (isSubmittingForKey(streamKey)) {
        logger.warn(
          `[DEBUG_STREAMING] Preventing duplicate message submission for streamKey: ${streamKey}`,
        );
        return undefined;
      }
      logger.log(
        `[DEBUG_STREAMING] sendMessage called. Content: "${content}", Files: ${inputFileIds?.length ?? 0}, Model: ${modelId ?? "default"}, Assistant: ${assistantId ?? "none"}`,
      );

      // Create optimistic user message immediately on submit so UI updates first.
      const userMessage = createOptimisticUserMessage(content, inputFileIds);
      logger.log(
        "[DEBUG_STREAMING] sendMessage: Adding optimistic user message to store:",
        userMessage,
      );
      addUserMessage(userMessage, streamKey);

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

      setSubmittingForKey(streamKey, true);
      logger.log(
        "[DEBUG_STREAMING] sendMessage: isSubmittingRef.current set to true.",
      );

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
        resetStreaming(streamKey);

        // ERMAIN-88 FIX: Create optimistic assistant placeholder immediately
        // This provides instant UI feedback while the POST request is being processed
        const optimisticAssistantId = `temp-assistant-${Date.now()}`;
        const now = new Date().toISOString();
        logger.log(
          `[DEBUG_STREAMING] sendMessage: Creating optimistic assistant placeholder immediately with ID: ${optimisticAssistantId}`,
        );
        const { setStreaming } = useMessagingStore.getState();
        setStreaming(
          {
            isStreaming: false, // Not streaming yet - just a "thinking" placeholder
            currentMessageId: optimisticAssistantId,
            content: [],
            createdAt: now,
            isFinalizing: false,
            toolCalls: {},
          },
          streamKey,
        );

        // Clean up any existing SSE connection
        const existingCleanup = getSSECleanupForKey(streamKey);
        if (existingCleanup) {
          logger.log(
            "[DEBUG_STREAMING] sendMessage: Closing previous SSE connection before creating a new one.",
          );
          // logger.log(
          //   `[CHAT_FLOW_LIFECYCLE_DEBUG] sendMessage: Cleaning up existing sseCleanupRef for chatId: ${chatId ?? "null"} before new connection.`,
          // );
          existingCleanup();
          setSSECleanupForKey(streamKey, null);

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
          selectedFacetIds,
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

        const sseUrl = `/api/v1beta/me/messages/submitstream`;

        // The SSE client will handle the POST request format
        // logger.log(
        //   `[CHAT_FLOW_LIFECYCLE_DEBUG] sendMessage: About to call createSSEConnection for chatId: ${chatId ?? "null"}. sseCleanupRef.current is currently ${sseCleanupRef.current ? "set" : "null"}.`,
        // );
        logger.log(
          `[DEBUG_STREAMING] sendMessage: Calling createSSEConnection. Current stream-keyed cleanup is ${getSSECleanupForKey(streamKey) ? "set" : "null"}.`,
        );

        const connectionStreamKeyRef = { current: streamKey };

        // Store the abort function in both the ref AND the global store
        // This allows external code (like createNewChat) to abort the connection
        const cleanup = createSSEConnection(sseUrl, {
          onMessage: (sseEvent) =>
            processStreamEvent(sseEvent, connectionStreamKeyRef),
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
            const activeStreamKey = connectionStreamKeyRef.current;
            resetStreaming(activeStreamKey);

            // Use the new utility for refetch and clear
            logger.log(
              "[DEBUG_STREAMING] SSE onError: Calling handleRefetchAndClear.",
            );
            void handleRefetchAndClear({ logContext: "SSE error" });

            setSubmittingForKey(activeStreamKey, false); // Reset submission flag on error
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
            const activeStreamKey = connectionStreamKeyRef.current;
            const currentlyStreaming = isStreamCurrentlyActive(activeStreamKey);
            const recentlyCompletedAt =
              recentlyCompletedByKeyRef.current[activeStreamKey] ?? 0;
            const isCloseLikelyPostCompletion =
              Date.now() - recentlyCompletedAt < COMPLETION_CLOSE_DEDUP_MS;
            logger.log(
              "[DEBUG_STREAMING] SSE connection closed via onClose callback in useChatMessaging.",
              {
                isSubmitting: isSubmittingForKey(activeStreamKey),
                isStreaming: currentlyStreaming,
                isCloseLikelyPostCompletion,
              },
            );
            setSubmittingForKey(activeStreamKey, false);
            logger.log(
              "[DEBUG_STREAMING] SSE onClose: isSubmittingRef.current set to false.",
            );

            if (!currentlyStreaming) {
              if (isCloseLikelyPostCompletion) {
                logger.log(
                  "[DEBUG_STREAMING] SSE onClose: Skipping duplicate refetch because completion was handled recently.",
                );
                return;
              }
              logger.log(
                "[DEBUG_STREAMING] SSE onClose: Not streaming, calling handleRefetchAndClear.",
              );
              void handleRefetchAndClear({ logContext: "SSE closed normally" });
            } else if (currentlyStreaming) {
              logger.warn(
                "[DEBUG_STREAMING] SSE connection closed unexpectedly while streaming was still active.",
              );
              // Use setError from store
              setError(new Error("SSE connection closed unexpectedly"));

              // Reset streaming state
              logger.log(
                "[DEBUG_STREAMING] SSE onClose (unexpected): Resetting streaming state.",
              );
              resetStreaming(activeStreamKey);

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
        setSSECleanupForKey(streamKey, cleanup);
        setSSEAbortCallback(cleanup, streamKey);

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
        resetStreaming(streamKey);

        // Use the new utility for refetch and clear
        logger.log(
          "[DEBUG_STREAMING] sendMessage catch: Calling handleRefetchAndClear.",
        );
        void handleRefetchAndClear({ logContext: "Send message error" });

        setSubmittingForKey(streamKey, false); // Reset submission flag on error
        logger.log(
          "[DEBUG_STREAMING] sendMessage catch: isSubmittingRef.current set to false.",
        );
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
      setError,
      handleRefetchAndClear,
      setNewlyCreatedChatIdInStore,
      setAwaitingFirstStreamChunkForNewChat,
      setSSEAbortCallback,
      isStreamCurrentlyActive,
      streamKey,
      getSSECleanupForKey,
      setSSECleanupForKey,
      isSubmittingForKey,
      setSubmittingForKey,
    ],
  );

  // Edit an existing message (rerun with modified user content and optional files)
  const editMessage = useCallback(
    async (
      messageId: string,
      newContent: string,
      replaceInputFileIds?: string[],
      selectedFacetIds?: string[],
    ): Promise<void> => {
      if (isSubmittingForKey(streamKey)) {
        logger.warn("[DEBUG_STREAMING] Preventing duplicate edit submission");
        return;
      }

      // Clear any previous streaming state and close existing SSE connection
      resetStreaming(streamKey);
      const existingCleanup = getSSECleanupForKey(streamKey);
      if (existingCleanup) {
        existingCleanup();
        setSSECleanupForKey(streamKey, null);
      }

      setSubmittingForKey(streamKey, true);

      try {
        const requestBody = {
          message_id: messageId,
          replace_user_message: newContent,
          ...(replaceInputFileIds && replaceInputFileIds.length > 0
            ? { replace_input_files_ids: replaceInputFileIds }
            : {}),
          ...(selectedFacetIds ? { selected_facet_ids: selectedFacetIds } : {}),
        } as const;

        const sseUrl = `/api/v1beta/me/messages/editstream`;
        const connectionStreamKeyRef = { current: streamKey };
        const cleanup = createSSEConnection(sseUrl, {
          onMessage: (sseEvent) =>
            processStreamEvent(sseEvent, connectionStreamKeyRef),
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
            resetStreaming(streamKey);
            void handleRefetchAndClear({ logContext: "SSE error (edit)" });
            setSubmittingForKey(streamKey, false);
          },
          onOpen: () => {
            // no-op
          },
          onClose: () => {
            const activeStreamKey = connectionStreamKeyRef.current;
            const currentlyStreaming = isStreamCurrentlyActive(activeStreamKey);
            setSubmittingForKey(activeStreamKey, false);
            if (!currentlyStreaming) {
              void handleRefetchAndClear({
                logContext: "Edit SSE closed normally",
              });
            } else {
              logger.warn(
                "[DEBUG_STREAMING] Edit SSE connection closed unexpectedly while streaming was still active.",
              );
              setError(new Error("SSE connection closed unexpectedly (edit)"));
              resetStreaming(streamKey);
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
        setSSECleanupForKey(streamKey, cleanup);
        setSSEAbortCallback(cleanup, streamKey);
      } catch (err) {
        logger.error("[DEBUG_STREAMING] editMessage error:", err);
        setError(
          err instanceof Error ? err : new Error("Failed to edit message"),
        );
        resetStreaming(streamKey);

        void handleRefetchAndClear({ logContext: "Edit message error" });
        setSubmittingForKey(streamKey, false);
      }
    },
    [
      handleRefetchAndClear,
      processStreamEvent,
      resetStreaming,
      setError,
      setSSEAbortCallback,
      isStreamCurrentlyActive,
      streamKey,
      getSSECleanupForKey,
      setSSECleanupForKey,
    ],
  );

  // Regenerate an assistant response for an existing message
  const regenerateMessage = useCallback(
    async (
      currentMessageId: string,
      selectedFacetIds?: string[],
    ): Promise<void> => {
      if (isSubmittingForKey(streamKey)) {
        logger.warn(
          "[DEBUG_STREAMING] Preventing duplicate regenerate submission",
        );
        return;
      }

      // Clear any previous streaming state and close existing SSE connection
      resetStreaming(streamKey);
      const existingCleanup = getSSECleanupForKey(streamKey);
      if (existingCleanup) {
        existingCleanup();
        setSSECleanupForKey(streamKey, null);
      }

      setSubmittingForKey(streamKey, true);

      try {
        const requestBody = {
          current_message_id: currentMessageId,
          ...(selectedFacetIds ? { selected_facet_ids: selectedFacetIds } : {}),
        };

        const sseUrl = `/api/v1beta/me/messages/regeneratestream`;
        const connectionStreamKeyRef = { current: streamKey };
        const cleanup = createSSEConnection(sseUrl, {
          onMessage: (sseEvent) =>
            processStreamEvent(sseEvent, connectionStreamKeyRef),
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
            resetStreaming(streamKey);
            void handleRefetchAndClear({
              logContext: "SSE error (regenerate)",
            });
            setSubmittingForKey(streamKey, false);
          },
          onOpen: () => {
            // no-op
          },
          onClose: () => {
            const activeStreamKey = connectionStreamKeyRef.current;
            const currentlyStreaming = isStreamCurrentlyActive(activeStreamKey);
            setSubmittingForKey(activeStreamKey, false);
            if (!currentlyStreaming) {
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
              resetStreaming(streamKey);
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
        setSSECleanupForKey(streamKey, cleanup);
        setSSEAbortCallback(cleanup, streamKey);
      } catch (err) {
        logger.error("[DEBUG_STREAMING] regenerateMessage error:", err);
        setError(
          err instanceof Error
            ? err
            : new Error("Failed to regenerate message"),
        );
        resetStreaming(streamKey);

        void handleRefetchAndClear({ logContext: "Regenerate message error" });
        setSubmittingForKey(streamKey, false);
      }
    },
    [
      handleRefetchAndClear,
      processStreamEvent,
      resetStreaming,
      setError,
      setSSEAbortCallback,
      isStreamCurrentlyActive,
      streamKey,
      getSSECleanupForKey,
      setSSECleanupForKey,
    ],
  );

  // isPendingResponse is true from the moment send is clicked until streaming completes
  // This is different from isStreaming which only becomes true after the first chunk arrives
  const isPendingResponse =
    isSubmittingForKey(streamKey) ||
    streaming.isStreaming ||
    streaming.isFinalizing;

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
