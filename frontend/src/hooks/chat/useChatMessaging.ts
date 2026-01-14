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

interface UseChatMessagingParams {
  chatId: string | null;
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
) {
  const chatId =
    typeof chatIdOrParams === "string" || chatIdOrParams === null
      ? chatIdOrParams
      : chatIdOrParams.chatId;

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
  const [newlyCreatedChatId, setNewlyCreatedChatId] = useState<string | null>(
    null,
  );

  const explicitNav = useExplicitNavigation();

  useEffect(() => {
    const currentChatId = chatId; // Capture chatId for cleanup
    const isInTransition =
      useMessagingStore.getState().isInNavigationTransition;

    if (process.env.NODE_ENV === "development") {
      logger.log(
        `[DEBUG_STREAMING] useChatMessaging mounted. chatId: ${currentChatId ?? "null"}, silentChatId: ${silentChatId ?? "null"}, isInTransition: ${isInTransition}`,
      );
    }

    if (isInTransition) {
      logger.log(
        "[DEBUG_STREAMING] Skipping state reset during navigation transition to preserve optimistic state.",
      );
      return () => {
        logger.log(
          `[DEBUG_STREAMING] useChatMessaging cleanup skipped during transition. chatId: ${currentChatId ?? "null"}`,
        );
      };
    }

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
    } else {
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

    logger.log(
      "[DEBUG_STREAMING] Resetting streaming state on mount/chatId change.",
    );
    resetStreaming();

    logger.log(
      "[DEBUG_REDIRECT] Resetting newlyCreatedChatId on mount/chatId change.",
    );
    setNewlyCreatedChatId(null);

    return () => {
      if (process.env.NODE_ENV === "development") {
        logger.log(
          `[DEBUG_STREAMING] useChatMessaging unmounting. chatId: ${currentChatId ?? "null"}`,
        );
      }
    };
  }, [chatId, clearCompletedUserMessages, resetStreaming, silentChatId]);

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

  const handleRefetchAndClear = useCallback(
    async (options: { invalidate?: boolean; logContext: string }) => {
      const { invalidate = false, logContext } = options;

      const isInTransition =
        useMessagingStore.getState().isInNavigationTransition;
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
        await chatMessagesQuery.refetch();

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

      if (logContext.includes("completed")) {
        logger.log(
          `[DEBUG_STREAMING] ${logContext}: Setting isFinalizing to false and resetting streaming state`,
        );
        const { resetStreaming } = useMessagingStore.getState();
        resetStreaming();

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

  const cancelMessage = useCallback(() => {
    const isInTransition =
      useMessagingStore.getState().isInNavigationTransition;

    if (sseCleanupRef.current) {
      sseCleanupRef.current();
      sseCleanupRef.current = null;
    }

    resetStreaming();

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

    isSubmittingRef.current = false;

    if (process.env.NODE_ENV === "development") {
      logger.log(
        "[DEBUG_STREAMING] Message cancelled by calling cancelMessage.",
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetStreaming, clearCompletedUserMessages, chatId]);

  useEffect(() => {
    const capturedChatIdForCleanup = chatId;

    return () => {
      const isInTransition =
        useMessagingStore.getState().isInNavigationTransition;

      if (isInTransition) {
        logger.log(
          `[DEBUG_STREAMING] SSE Cleanup skipped during navigation transition for chatId: ${capturedChatIdForCleanup ?? "null"}`,
        );
        return;
      }

      if (sseCleanupRef.current) {
        logger.log(
          `[DEBUG_STREAMING] SSE Cleanup: Closing SSE connection for chatId: ${capturedChatIdForCleanup ?? "null"}`,
        );
        sseCleanupRef.current();
        sseCleanupRef.current = null;
      }

      logger.log(
        "[DEBUG_STREAMING] SSE Cleanup: Resetting isSubmittingRef.current to false.",
      );
      isSubmittingRef.current = false;

      logger.log("SSE Cleanup: Calling resetStreaming.");
      resetStreaming();

      logger.log("SSE Cleanup: Clearing error state.");
      setError(null);
    };
  }, [chatId, resetStreaming, setError]);

  const combinedMessages = useMemo(() => {
    const localUserMsgs = Object.values(userMessages);

    if (!chatId) {
      const { scenario } = handleNullChatIdScenario(
        userMessages,
        "combinedMessages",
      );

      if (scenario === "post_archive") {
        return {};
      } else {
        if (process.env.NODE_ENV === "development") {
          logger.log(
            "[DEBUG_STREAMING] combinedMessages: New chat scenario with optimistic messages",
            {
              localMessages: localUserMsgs.length,
              userMessagesState: userMessages,
            },
          );
        }
        return mergeDisplayMessages([], localUserMsgs);
      }
    }

    const apiMsgs: Message[] =
      chatMessagesQuery.data?.messages
        .map(mapApiMessageToUiMessage)
        .filter((m) => m.is_message_in_active_thread !== false) ?? [];

    const merged = mergeDisplayMessages(apiMsgs, localUserMsgs);

    if (process.env.NODE_ENV === "development" && localUserMsgs.length > 0) {
      logger.log(
        "[DEBUG_STREAMING] Combined messages (using mergeDisplayMessages):",
        {
          apiMessages: apiMsgs.length,
          localMessages: localUserMsgs.length,
          finalMessages: Object.keys(merged).length,
          currentChatId: chatId,
          userMessagesState: userMessages,
        },
      );
    }
    return merged;
  }, [chatMessagesQuery.data, userMessages, chatId]);

  const messages = useMemo(() => {
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

    const realMessageExists: boolean =
      !!combinedMessages[streaming.currentMessageId];

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

    finalMessagesRecord[streaming.currentMessageId] = {
      id: streaming.currentMessageId,
      content: streaming.content,
      role: "assistant",
      createdAt: streaming.createdAt ?? new Date().toISOString(),
      status: streaming.isStreaming ? "sending" : "complete",
    };
    return finalMessagesRecord;
  }, [combinedMessages, streaming]);

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

  const processStreamEvent = useCallback(
    (event: SSEEvent) => {
      try {
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
            handleTextDelta(responseData);
            break;

          case "assistant_message_completed":
            logger.log(
              "[DEBUG_STREAMING] processStreamEvent: assistant_message_completed event. Full payload:",
              responseData,
            );
            externalHandleMessageComplete(responseData, explicitNav);

            logger.log(
              "[DEBUG_STREAMING] processStreamEvent: assistant_message_completed - calling handleRefetchAndClear.",
            );
            void handleRefetchAndClear({
              invalidate: true,
              logContext: "Assistant message completed",
            }).then(() => {
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
            break;
        }
      } catch (err) {
        logger.error("[DEBUG_STREAMING] Error parsing SSE data:", {
          err,
          rawData: event.data,
        });
      }
    },
    [setNewlyCreatedChatId, handleRefetchAndClear, explicitNav],
  );

  const findMostRecentAssistantMessageId = useCallback(() => {
    let previousMessageId: string | undefined = undefined;

    for (let i = messageOrder.length - 1; i >= 0; i--) {
      const messageId = messageOrder[i];
      const message = messages[messageId];
      if (message.role === "assistant") {
        previousMessageId = messageId;
        break;
      }
    }

    if (process.env.NODE_ENV === "development") {
      logger.log("[DEBUG_STREAMING] Using previous_message_id:", {
        previousMessageId,
        from: messageOrder.length,
        totalMessages: Object.keys(messages).length,
      });
    }

    return previousMessageId;
  }, [messages, messageOrder]);

  const sendMessage = useCallback(
    async (
      content: string,
      inputFileIds?: string[],
      modelId?: string,
      assistantId?: string,
    ): Promise<string | undefined> => {
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
        logger.log(
          `[DEBUG_REDIRECT] sendMessage: Also setting store newlyCreatedChatIdInStore to: ${silentChatId}`,
        );
        setNewlyCreatedChatIdInStore(silentChatId);
        logger.log(
          `[DEBUG_REDIRECT] sendMessage: Setting isAwaitingFirstStreamChunkForNewChat to true to delay navigation`,
        );
        setAwaitingFirstStreamChunkForNewChat(true);
      } else {
        logger.log(
          `[DEBUG_REDIRECT] sendMessage: Setting newlyCreatedChatId to null (no silentChatId). Current newlyCreatedChatId: ${newlyCreatedChatId}`,
        );
        setNewlyCreatedChatId(null);
        setNewlyCreatedChatIdInStore(null);
      }

      isSubmittingRef.current = true;
      logger.log(
        "[DEBUG_STREAMING] sendMessage: isSubmittingRef.current set to true.",
      );

      const userMessage = createOptimisticUserMessage(content, inputFileIds);
      logger.log(
        "[DEBUG_STREAMING] sendMessage: Adding optimistic user message to store:",
        userMessage,
      );
      addUserMessage(userMessage);

      try {
        logger.log(
          "[DEBUG_STREAMING] sendMessage: Resetting streaming state before SSE connection.",
        );
        resetStreaming();

        const optimisticAssistantId = `temp-assistant-${Date.now()}`;
        const now = new Date().toISOString();
        logger.log(
          `[DEBUG_STREAMING] sendMessage: Creating optimistic assistant placeholder immediately with ID: ${optimisticAssistantId}`,
        );
        const { setStreaming } = useMessagingStore.getState();
        setStreaming({
          isStreaming: false,
          currentMessageId: optimisticAssistantId,
          content: [],
          createdAt: now,
          isFinalizing: false,
          toolCalls: {},
        });

        if (sseCleanupRef.current) {
          logger.log(
            "[DEBUG_STREAMING] sendMessage: Closing previous SSE connection before creating a new one.",
          );
          sseCleanupRef.current();
          sseCleanupRef.current = null;

          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        const previousMessageId = findMostRecentAssistantMessageId();
        logger.log(
          `[DEBUG_STREAMING] sendMessage: Determined previousMessageId: ${previousMessageId}`,
        );

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

        // eslint-disable-next-line lingui/no-unlocalized-strings
        const sseUrl = `/api/v1beta/me/messages/submitstream`;

        logger.log(
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          `[DEBUG_STREAMING] sendMessage: Calling createSSEConnection. Current sseCleanupRef is ${sseCleanupRef.current ? "set" : "null"}.`,
        );
        sseCleanupRef.current = createSSEConnection(sseUrl, {
          onMessage: processStreamEvent,
          onError: (errorEvent) => {
            const connectionError =
              errorEvent instanceof Error
                ? errorEvent
                : new Error("SSE connection error");
            logger.error(
              "[DEBUG_STREAMING] SSE connection error in useChatMessaging:",
              connectionError,
            );
            setError(connectionError);

            logger.log(
              "[DEBUG_STREAMING] SSE onError: Resetting streaming state.",
            );
            resetStreaming();

            logger.log(
              "[DEBUG_STREAMING] SSE onError: Calling handleRefetchAndClear.",
            );
            void handleRefetchAndClear({ logContext: "SSE error" });

            isSubmittingRef.current = false;
            logger.log(
              "[DEBUG_STREAMING] SSE onError: isSubmittingRef.current set to false.",
            );
          },
          onOpen: () => {
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
              logger.log(
                "[DEBUG_STREAMING] SSE onClose: Not streaming, calling handleRefetchAndClear.",
              );
              void handleRefetchAndClear({ logContext: "SSE closed normally" });
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            } else if (streaming.isStreaming) {
              logger.warn(
                "[DEBUG_STREAMING] SSE connection closed unexpectedly while streaming was still active.",
              );
              setError(new Error("SSE connection closed unexpectedly"));

              logger.log(
                "[DEBUG_STREAMING] SSE onClose (unexpected): Resetting streaming state.",
              );
              resetStreaming();

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
        logger.log(
          `[DEBUG_STREAMING] sendMessage: Assigned new cleanup to sseCleanupRef.current.`,
        );

        return Promise.resolve(undefined);
      } catch (error) {
        logger.error(
          "[DEBUG_STREAMING] Error in sendMessage try-catch block:",
          error,
        );
        setError(
          error instanceof Error ? error : new Error("Failed to send message"),
        );

        logger.log(
          "[DEBUG_STREAMING] sendMessage catch: Resetting streaming state.",
        );
        resetStreaming();

        logger.log(
          "[DEBUG_STREAMING] sendMessage catch: Calling handleRefetchAndClear.",
        );
        void handleRefetchAndClear({ logContext: "Send message error" });

        isSubmittingRef.current = false;
        logger.log(
          "[DEBUG_STREAMING] sendMessage catch: isSubmittingRef.current set to false.",
        );
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
          onOpen: () => {},
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
      streaming.isStreaming,
    ],
  );

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
          onOpen: () => {},
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
      streaming.isStreaming,
    ],
  );

  return {
    messages,
    isLoading: chatMessagesQuery.isLoading,
    isStreaming: streaming.isStreaming,
    isFinalizing: streaming.isFinalizing,
    streamingContent: streaming.content,
    error: chatMessagesQuery.error ?? error,
    sendMessage,
    editMessage,
    regenerateMessage,
    cancelMessage,
    refetch: chatMessagesQuery.refetch,
    newlyCreatedChatId,
    messageOrder,
  };
}
