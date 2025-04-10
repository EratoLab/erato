/**
 * Custom hook for chat messaging
 *
 * Provides a unified interface for sending messages, handling streaming responses,
 * and managing the current chat's messages.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { create } from "zustand";

import { useChatMessages } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { createSSEConnection, type SSEEvent } from "@/utils/sse/sseClient";

import type {
  ChatMessage as ApiChatMessage,
  MessageSubmitStreamingResponseMessage,
  MessageSubmitStreamingResponseMessageTextDelta,
  MessageSubmitStreamingResponseChatCreated,
  MessageSubmitStreamingResponseMessageComplete,
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
  };
});

export function useChatMessaging({
  chatId,
  onChatCreated,
}: UseChatMessagingParams) {
  const queryClient = useQueryClient();
  const [lastError, setLastError] = useState<Error | null>(null);
  const {
    streaming,
    setStreaming,
    resetStreaming,
    userMessages,
    addUserMessage,
    clearUserMessages,
  } = useMessagingStore();
  const sseCleanupRef = useRef<(() => void) | null>(null);
  const isSubmittingRef = useRef(false);
  const pendingChatIdRef = useRef<string | null>(null);

  // Store a mapping from temp streaming IDs to real backend IDs
  const tempToRealIdMapRef = useRef<Record<string, string>>({});

  // Log hook mounting and unmounting - keep this for debugging chat lifecycle
  useEffect(() => {
    const currentChatId = chatId; // Capture chatId for cleanup
    // Only log in development
    if (process.env.NODE_ENV === "development") {
      console.log(
        `[CHAT_FLOW_LIFECYCLE] useChatMessaging mounted for chatId: ${currentChatId ?? "null"}`,
      );
    }

    // Only clear user messages if we're not coming from a navigation
    // This helps preserve messages during chat creation/navigation
    if (!pendingChatIdRef.current) {
      clearUserMessages();
    }

    // Check for messages stored in localStorage during navigation
    if (currentChatId) {
      try {
        // Attempt to find saved messages for this chat
        const savedMessages = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith("temp_message_")) {
            try {
              const savedMessage = JSON.parse(localStorage.getItem(key) || "");
              if (savedMessage) {
                savedMessages.push(savedMessage);
                localStorage.removeItem(key); // Clean up after retrieval
              }
            } catch {
              // Ignore parsing errors for individual items
            }
          }
        }

        // Add saved messages to the store
        if (savedMessages.length > 0) {
          if (process.env.NODE_ENV === "development") {
            console.log(
              "[CHAT_FLOW] Restoring saved messages:",
              savedMessages.length,
            );
          }
          savedMessages.forEach((msg) => addUserMessage(msg));
        }
      } catch {
        console.warn("[CHAT_FLOW] Error restoring messages from localStorage");
      }
    }

    // Reset the pending chat ID when chatId changes
    pendingChatIdRef.current = null;
    // Reset the ID mapping
    tempToRealIdMapRef.current = {};

    return () => {
      // Only log in development
      if (process.env.NODE_ENV === "development") {
        console.log(
          `[CHAT_FLOW_LIFECYCLE] useChatMessaging unmounting for chatId: ${currentChatId ?? "null"}`,
        );
      }
    };
  }, [chatId, clearUserMessages, addUserMessage]);

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
      chatMessagesQuery.data?.messages.map((msg: ApiChatMessage) => ({
        id: msg.id || `temp-api-${Date.now()}`,
        content: msg.full_text || "",
        role: msg.role as "user" | "assistant" | "system", // Use exact role from API
        createdAt: msg.created_at || new Date().toISOString(),
        status: "complete",
        // Handle the previous_message_id conversion properly
        previous_message_id:
          msg.previous_message_id && typeof msg.previous_message_id === "string"
            ? msg.previous_message_id
            : undefined,
      })) || [];

    // Convert locally stored user messages to Message[] array
    const localUserMsgs = Object.values(userMessages);

    // Create a Map to store unique messages, preferring API messages
    const messageMap = new Map<string, Message>();

    // First add all API messages to ensure they take precedence
    apiMsgs.forEach((msg) => {
      messageMap.set(msg.id, msg);
    });

    // Then add local messages only if they don't conflict with API messages
    localUserMsgs.forEach((msg) => {
      if (!messageMap.has(msg.id)) {
        messageMap.set(msg.id, msg);
      }
    });

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
      const latestContent = useMessagingStore.getState().streaming.content;
      setStreaming({
        content: latestContent + responseData.new_text,
      });
    },
    [setStreaming],
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
      const realMessageData = responseData.message;
      const realMessageId = realMessageData.id || responseData.message_id;
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

      // Store the mapping from temp ID to real ID
      if (tempMessageId && realMessageId) {
        tempToRealIdMapRef.current[tempMessageId] = realMessageId;
      }

      // Store the complete message with the REAL ID from the backend
      if (realMessageId) {
        // Convert previous_message_id to string or undefined
        const prevMsgId =
          typeof realMessageData.previous_message_id === "string"
            ? realMessageData.previous_message_id
            : undefined;

        const finalMessage: Message = {
          id: realMessageId, // Use the real ID from the backend
          content: finalContent,
          role: "assistant",
          createdAt: realMessageData.created_at || new Date().toISOString(),
          status: "complete",
          previous_message_id: prevMsgId,
        };

        // Add to userMessages store
        addUserMessage(finalMessage);

        // If we're about to navigate to a new chat, also store this in localStorage
        // This ensures the message persists during navigation
        if (pendingChatIdRef.current) {
          try {
            // Store both the assistant message and its context in localStorage
            const assistantKey = `temp_message_${realMessageId}`;
            localStorage.setItem(assistantKey, JSON.stringify(finalMessage));

            // We also need to store information about the previous message (user's question)
            // to avoid duplication
            if (prevMsgId) {
              const userMsgKey = `seen_message_${prevMsgId as string}`;
              localStorage.setItem(userMsgKey, "true");

              // Set an expiration (5 minutes) so we don't fill localStorage
              setTimeout(
                () => {
                  localStorage.removeItem(userMsgKey);
                },
                5 * 60 * 1000,
              );
            }

            // Set an expiration (5 minutes) so we don't fill localStorage
            setTimeout(
              () => {
                localStorage.removeItem(assistantKey);
              },
              5 * 60 * 1000,
            );
          } catch (e) {
            // Ignore storage errors
            console.warn(
              "[CHAT_FLOW] Failed to store message in localStorage",
              e,
            );
          }
        }
      }

      // Update streaming state
      setStreaming({
        isStreaming: false,
        content: finalContent,
        currentMessageId: realMessageId || null, // Update to real ID
      });

      // Invalidate query
      void queryClient.invalidateQueries({
        queryKey: ["chatMessages", { chatId }],
      });

      // Handle navigation if needed
      if (pendingChatIdRef.current) {
        if (process.env.NODE_ENV === "development") {
          console.log(
            "[CHAT_FLOW] Message complete, navigate to:",
            pendingChatIdRef.current,
          );
        }
        // We've already checked pendingChatIdRef.current is not null
        onChatCreated?.(pendingChatIdRef.current);
        // Don't clear pendingChatIdRef.current here, we'll use it in the cleanup
      }
    },
    [chatId, queryClient, setStreaming, addUserMessage, onChatCreated],
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
            // No action needed
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
    [handleTextDelta, handleMessageComplete, handleChatCreated],
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

          // Check if this is a temp ID that has a real ID mapping
          const realId = tempToRealIdMapRef.current[messageId];
          previousMessageId = realId || messageId;
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
      const tempUserMessageId = `temp-user-${Date.now()}`;
      const userMessage: Message = {
        id: tempUserMessageId,
        content,
        role: "user",
        createdAt: new Date().toISOString(),
        status: "sending", // Indicate it's being sent
      };
      addUserMessage(userMessage);

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
            resetStreaming();
            isSubmittingRef.current = false; // Reset submission flag on error
          },
          onOpen: () => {
            // No action needed
          },
          onClose: () => {
            // When SSE connection closes, make sure to invalidate the query
            if (!streaming.isStreaming) {
              // Normal close - invalidate the query
              void queryClient.invalidateQueries({
                queryKey: ["chatMessages", { chatId }],
              });

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
            } else if (streaming.isStreaming) {
              console.warn("[CHAT_FLOW] SSE connection closed unexpectedly");
              setLastError(new Error("SSE connection closed unexpectedly"));
              resetStreaming();
            }

            // Reset submission flag on close
            isSubmittingRef.current = false;
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
        resetStreaming();
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
      queryClient,
      addUserMessage,
      processStreamEvent,
      findMostRecentAssistantMessageId,
      onChatCreated,
    ],
  );

  return {
    messages,
    isLoading: chatMessagesQuery.isLoading,
    isStreaming: streaming.isStreaming,
    streamingContent: streaming.content,
    error: lastError || chatMessagesQuery.error,
    sendMessage,
    refetch: chatMessagesQuery.refetch,
  };
}
