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
import { create } from "zustand";

import { useChatMessages } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { mapApiMessageToUiMessage } from "@/utils/adapters/messageAdapter";
import { createSSEConnection, type SSEEvent } from "@/utils/sse/sseClient";

import type {
  MessageSubmitStreamingResponseMessage,
  MessageSubmitStreamingResponseMessageTextDelta,
  MessageSubmitStreamingResponseChatCreated,
  MessageSubmitStreamingResponseMessageComplete,
  MessageSubmitStreamingResponseUserMessageSaved,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Message } from "@/types/chat";

// Add navigateToChat to the parameters
interface UseChatMessagingParams {
  chatId: string | null;
  onChatCreated?: (newChatId: string) => void;
}

// Streaming state
interface StreamingState {
  isStreaming: boolean;
  currentMessageId: string | null;
  content: string;
}

// Add user messages to the store
interface MessagingStore {
  streaming: StreamingState;
  userMessages: Record<string, Message>; // Store user messages keyed by a temporary ID
  setStreaming: (state: Partial<StreamingState>) => void;
  resetStreaming: () => void;
  addUserMessage: (message: Message) => void;
  clearUserMessages: () => void;
  // New method to only clear messages that are not in sending state
  clearCompletedUserMessages: () => void;
}

// Initial streaming state
const initialStreamingState: StreamingState = {
  isStreaming: false,
  currentMessageId: null,
  content: "",
};

// Create a store for messaging state
const useMessagingStore = create<MessagingStore>((set) => {
  return {
    streaming: initialStreamingState,
    userMessages: {},
    setStreaming: (state) =>
      set((prev) => {
        return {
          ...prev,
          streaming: { ...prev.streaming, ...state },
        };
      }),
    resetStreaming: () => {
      set({ streaming: initialStreamingState });
    },
    addUserMessage: (message) =>
      set((prev) => {
        return {
          ...prev,
          userMessages: { ...prev.userMessages, [message.id]: message },
        };
      }),
    clearUserMessages: () => {
      set({ userMessages: {} });
    },
    // New method that only clears messages that are not in sending state
    clearCompletedUserMessages: () => {
      set((prev) => {
        const filteredMessages = Object.entries(prev.userMessages).reduce(
          (acc, [id, msg]) => {
            // Keep messages that are still in sending state
            if (msg.status === "sending") {
              acc[id] = msg;
            }
            return acc;
          },
          {} as Record<string, Message>,
        );
        return { ...prev, userMessages: filteredMessages };
      });
    },
  };
});

export function useChatMessaging(
  chatIdOrParams: string | null | UseChatMessagingParams,
  legacyOnChatCreated?: (newChatId: string) => void,
) {
  // Support both old and new function signatures for backward compatibility
  const chatId =
    typeof chatIdOrParams === "string" || chatIdOrParams === null
      ? chatIdOrParams
      : chatIdOrParams.chatId;

  const onChatCreated =
    typeof chatIdOrParams === "string" || chatIdOrParams === null
      ? legacyOnChatCreated
      : chatIdOrParams.onChatCreated;

  const queryClient = useQueryClient();
  const [lastError, setLastError] = useState<Error | null>(null);
  const {
    streaming,
    setStreaming,
    resetStreaming,
    userMessages,
    addUserMessage,
    clearUserMessages,
    clearCompletedUserMessages,
  } = useMessagingStore();
  const sseCleanupRef = useRef<(() => void) | null>(null);
  const isSubmittingRef = useRef(false);
  const pendingChatIdRef = useRef<string | null>(null);

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

    // Reset pending chat ID and ID mapping when chatId changes
    pendingChatIdRef.current = null;

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

  // Clean up any existing SSE connection on unmount
  useEffect(() => {
    return () => {
      if (sseCleanupRef.current) {
        sseCleanupRef.current();
        sseCleanupRef.current = null;
      }
    };
  }, []);

  // Combine API messages and locally added user messages
  const combinedMessages = useMemo(() => {
    const apiMsgs: Message[] =
      chatMessagesQuery.data?.messages.map(mapApiMessageToUiMessage) ?? [];

    // Convert locally stored user messages to Message[] array
    const localUserMsgs = Object.values(userMessages);

    // Track which user messages have content that matches an API message
    // This helps prevent duplicates when the same message exists in both local and API state
    const apiUserMessageContents = new Set(
      apiMsgs.filter((msg) => msg.role === "user").map((msg) => msg.content),
    );

    // Create a Map to store unique messages, preferring API messages
    const messageMap = new Map<string, Message>();

    // First add all API messages to ensure they take precedence
    apiMsgs.forEach((msg) => {
      messageMap.set(msg.id, msg);
    });

    // Then add local messages only if they don't conflict with API messages
    localUserMsgs.forEach((msg) => {
      // Add the message if:
      // 1. It doesn't share an ID with an API message OR it's still in sending state
      // 2. AND its content doesn't match any API user message (to prevent duplicates)
      if (
        (!messageMap.has(msg.id) || msg.status === "sending") &&
        // Only deduplicate user messages, not assistant messages
        (msg.role !== "user" || !apiUserMessageContents.has(msg.content))
      ) {
        messageMap.set(msg.id, msg);
      }
    });

    // For debugging
    if (process.env.NODE_ENV === "development" && localUserMsgs.length > 0) {
      console.log("[CHAT_FLOW] Combined messages:", {
        apiMessages: apiMsgs.length,
        localMessages: localUserMsgs.length,
        finalMessages: messageMap.size,
      });
    }

    return Array.from(messageMap.values());
  }, [chatMessagesQuery.data, userMessages]);

  // Add the streaming message if it exists
  const messages = useMemo(() => {
    const finalMessages = [...combinedMessages];
    if (
      streaming.isStreaming &&
      streaming.currentMessageId &&
      streaming.content
    ) {
      finalMessages.push({
        id: streaming.currentMessageId,
        content: streaming.content,
        role: "assistant",
        createdAt: new Date().toISOString(),
        status: "sending",
      });
    }
    return finalMessages;
  }, [combinedMessages, streaming]);

  // Handlers for different SSE event types
  const handleTextDelta = useCallback(
    (
      responseData: MessageSubmitStreamingResponseMessageTextDelta & {
        message_type: "text_delta";
      },
    ) => {
      // Use a more performant way to update streaming content
      // This avoids going through multiple layers of state transformation
      // which can cause lag during rapid updates
      useMessagingStore.setState((state) => ({
        ...state,
        streaming: {
          ...state.streaming,
          content: state.streaming.content + responseData.new_text,
        },
      }));
    },
    [], // Remove dependency on setStreaming
  );

  const handleMessageComplete = useCallback(
    (
      responseData: MessageSubmitStreamingResponseMessageComplete & {
        message_type: "message_complete";
      },
    ) => {
      // Get the temporary message ID that's currently being displayed
      const tempMessageId =
        useMessagingStore.getState().streaming.currentMessageId;

      // Extract real message data from the backend
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- isUserMessage can be undefined based on props type
      const realMessageData = responseData.message || {}; // Handle missing message object
      const realMessageId =
        realMessageData.id || responseData.message_id || `msg-${Date.now()}`; // Fallback ID
      const finalContent =
        realMessageData.full_text ||
        responseData.full_text ||
        useMessagingStore.getState().streaming.content;

      if (process.env.NODE_ENV === "development") {
        console.log(
          "[CHAT_FLOW] Message complete, real ID:",
          realMessageId,
          "temp ID:",
          tempMessageId,
        );
      }

      // Update streaming state to indicate completion
      setStreaming({
        isStreaming: false,
        content: finalContent,
        currentMessageId: realMessageId || null, // Update to real ID
      });

      // Use the promise returned by invalidateQueries and refetch to ensure proper sequence
      if (chatId) {
        void queryClient
          .invalidateQueries({
            queryKey: ["chatMessages", { chatId }],
          })
          .then(() => {
            // This ensures we get fresh data before clearing temporary messages
            return chatMessagesQuery.refetch().then(() => {
              // Only clear completed messages, preserving user messages still in sending state
              clearCompletedUserMessages();
            });
          });
      }

      // Handle navigation if needed
      if (pendingChatIdRef.current) {
        if (process.env.NODE_ENV === "development") {
          console.log(
            "[CHAT_FLOW] Message complete, navigate to:",
            pendingChatIdRef.current,
          );
        }
        onChatCreated?.(pendingChatIdRef.current);
      }
    },
    [
      chatId,
      queryClient,
      setStreaming,
      onChatCreated,
      chatMessagesQuery,
      clearCompletedUserMessages,
    ],
  );

  const handleChatCreated = useCallback(
    (
      responseData: MessageSubmitStreamingResponseChatCreated & {
        message_type: "chat_created";
      },
    ) => {
      if (
        "chat_id" in responseData &&
        typeof responseData.chat_id === "string"
      ) {
        pendingChatIdRef.current = responseData.chat_id;
        if (process.env.NODE_ENV === "development") {
          console.log(
            "[CHAT_FLOW] Chat created, ID stored:",
            responseData.chat_id,
            "- Will navigate after streaming",
          );
        }
      } else {
        console.warn(
          "[CHAT_FLOW] Received chat_created event without a valid chat_id",
        );
      }
    },
    [],
  );

  // Handle user message saved event
  const handleUserMessageSaved = useCallback(
    (
      responseData: MessageSubmitStreamingResponseUserMessageSaved & {
        message_type: "user_message_saved";
      },
    ) => {
      if (process.env.NODE_ENV === "development") {
        console.log("[CHAT_FLOW] User message saved:", responseData.message_id);
      }

      // Update stored user messages to mark them as complete (not in sending state anymore)
      // This will help properly deduplicate messages after the API message is fetched
      const existingUserMessages = useMessagingStore.getState().userMessages;

      if (responseData.message.full_text) {
        const updatedMessages = { ...existingUserMessages };
        let updatedAny = false;

        Object.entries(updatedMessages).forEach(([id, msg]) => {
          if (
            msg.role === "user" &&
            msg.content === responseData.message.full_text &&
            msg.status === "sending"
          ) {
            updatedMessages[id] = {
              ...msg,
              status: "complete", // Mark as complete since it's now in the API
            };
            updatedAny = true;
          }
        });

        // Only update state if we actually changed something
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- isUserMessage can be undefined based on props type
        if (updatedAny) {
          useMessagingStore.setState((state) => ({
            ...state,
            userMessages: updatedMessages,
          }));
        }
      }
    },
    [],
  );

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
          case "text_delta":
            handleTextDelta(responseData);
            break;

          case "message_complete":
            handleMessageComplete(responseData);
            break;

          case "chat_created":
            handleChatCreated(responseData);
            break;

          case "user_message_saved":
            // Handle user message saved event
            handleUserMessageSaved(responseData);
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
      handleTextDelta,
      handleMessageComplete,
      handleChatCreated,
      handleUserMessageSaved,
    ],
  );

  // Find the most recent assistant message ID, including temporary ones
  const findMostRecentAssistantMessageId = useCallback(() => {
    let previousMessageId: string | undefined = undefined;

    // Gather all messages, including the ones in temporary store
    const allVisibleMessages = [...messages];

    // Add any assistant messages from userMessages that aren't in the main array
    Object.values(userMessages).forEach((msg) => {
      if (
        msg.role === "assistant" &&
        !allVisibleMessages.some((m) => m.id === msg.id)
      ) {
        allVisibleMessages.push(msg);
      }
    });

    // Sort messages by creation time, newest last
    allVisibleMessages.sort((a, b) => {
      const timeA = new Date(a.createdAt).getTime();
      const timeB = new Date(b.createdAt).getTime();
      return timeA - timeB;
    });

    // Look for the most recent assistant message
    if (allVisibleMessages.length > 0) {
      for (let i = allVisibleMessages.length - 1; i >= 0; i--) {
        if (allVisibleMessages[i].role === "assistant") {
          const messageId = allVisibleMessages[i].id;
          previousMessageId = messageId;
          break;
        }
      }
    }

    // Log which message we're using as previous_message_id
    if (process.env.NODE_ENV === "development") {
      console.log(
        "[CHAT_FLOW] Using previous_message_id:",
        previousMessageId,
        "from",
        allVisibleMessages.length,
        "total messages",
      );
    }

    return previousMessageId;
  }, [messages, userMessages]);

  // Send a message
  const sendMessage = useCallback(
    async (content: string) => {
      // Prevent duplicate submissions
      if (isSubmittingRef.current) {
        console.warn("[CHAT_FLOW] Preventing duplicate message submission");
        return;
      }

      isSubmittingRef.current = true;

      // Immediately add user message to local state for optimistic UI update
      // Use a more stable ID format that will be easier to identify later
      const timestamp = Date.now();
      const tempUserMessageId = `temp-user-${timestamp}`;
      const userMessage: Message = {
        id: tempUserMessageId,
        content,
        role: "user",
        createdAt: new Date(timestamp).toISOString(),
        status: "sending", // Indicate it's being sent
      };
      addUserMessage(userMessage);

      if (process.env.NODE_ENV === "development") {
        console.log(
          "[CHAT_FLOW] Added temporary user message:",
          tempUserMessageId,
        );
      }

      try {
        // Reset any previous streaming state
        resetStreaming();

        // Clean up any existing SSE connection
        if (sseCleanupRef.current) {
          sseCleanupRef.current();
          sseCleanupRef.current = null;
        }

        // Generate a temporary ID for the streaming message
        const tempMessageId = `stream-${Date.now()}`;

        // Update streaming state to indicate we're starting
        setStreaming({
          isStreaming: true,
          currentMessageId: tempMessageId,
          content: "",
        });

        // Find the most recent assistant message to use as previous_message_id
        const previousMessageId = findMostRecentAssistantMessageId();

        // Create the request body with or without previous_message_id
        const requestBody = previousMessageId
          ? {
              user_message: content,
              previous_message_id: previousMessageId,
            }
          : {
              user_message: content,
            };

        // Only log in development
        if (process.env.NODE_ENV === "development") {
          console.log(
            `[CHAT_FLOW] Creating SSE connection${chatId ? " (existing chat)" : " (new chat)"}`,
          );
        }

        // Create a direct SSE connection for streaming
        const sseUrl = `/api/v1beta/me/messages/submitstream`;

        // The SSE client will handle the POST request format
        sseCleanupRef.current = createSSEConnection(sseUrl, {
          onMessage: processStreamEvent,
          onError: (error) => {
            console.error("[CHAT_FLOW] SSE connection error:", error);
            setLastError(new Error("SSE connection error"));

            // Reset streaming state
            resetStreaming();

            // Clear temporary messages only after refetch completes
            if (chatId) {
              void chatMessagesQuery.refetch().then(() => {
                // Only clear completed messages to preserve the user message
                clearCompletedUserMessages();
              });
            } else {
              // Even for new chats, keep user messages during errors
              clearCompletedUserMessages();
            }

            isSubmittingRef.current = false; // Reset submission flag on error
          },
          onOpen: () => {
            // No action needed
            console.log("[CHAT_FLOW] SSE connection opened");
          },
          onClose: () => {
            // Reset submission flag
            isSubmittingRef.current = false;

            if (!streaming.isStreaming) {
              // Normal close - refetch and then clear temporary messages
              if (chatId) {
                void chatMessagesQuery.refetch().then(() => {
                  // Only clear completed messages to preserve user message
                  clearCompletedUserMessages();
                });
              } else {
                // For new chats, keep user messages
                clearCompletedUserMessages();
              }

              // Check for pending chat navigation
              if (pendingChatIdRef.current) {
                if (process.env.NODE_ENV === "development") {
                  console.log(
                    "[CHAT_FLOW] SSE closed, navigating to pending chat:",
                    pendingChatIdRef.current,
                  );
                }
                onChatCreated?.(pendingChatIdRef.current);
                pendingChatIdRef.current = null;
              }
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- isUserMessage can be undefined based on props type
            } else if (streaming.isStreaming) {
              // Abnormal close - streaming hadn't completed
              console.warn("[CHAT_FLOW] SSE connection closed unexpectedly");
              setLastError(new Error("SSE connection closed unexpectedly"));

              // Reset streaming state
              resetStreaming();

              // Refetch and then clear temporary messages
              if (chatId) {
                void chatMessagesQuery.refetch().then(() => {
                  // Only clear completed messages to preserve user message
                  clearCompletedUserMessages();
                });
              } else {
                // For new chats, keep user messages
                clearCompletedUserMessages();
              }
            }
          },
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        });

        return streaming.content;
      } catch (error) {
        console.error("[CHAT_FLOW] Error in sendMessage:", error);
        setLastError(
          error instanceof Error ? error : new Error("Failed to send message"),
        );

        // Reset streaming state
        resetStreaming();

        // Clear temporary messages after refetch completes - but preserve user message
        if (chatId) {
          void chatMessagesQuery.refetch().then(() => {
            clearCompletedUserMessages();
          });
        } else {
          clearCompletedUserMessages();
        }

        isSubmittingRef.current = false; // Reset submission flag on error
        throw error;
      }
    },
    [
      chatId,
      resetStreaming,
      setStreaming,
      streaming.content,
      streaming.isStreaming,
      addUserMessage,
      clearCompletedUserMessages,
      processStreamEvent,
      findMostRecentAssistantMessageId,
      onChatCreated,
      chatMessagesQuery,
    ],
  );

  return {
    messages,
    isLoading: chatMessagesQuery.isLoading,
    isStreaming: streaming.isStreaming,
    streamingContent: streaming.content,
    error: lastError ?? chatMessagesQuery.error,
    sendMessage,
    cancelMessage,
    refetch: chatMessagesQuery.refetch,
  };
}
