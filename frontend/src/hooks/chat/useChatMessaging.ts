/**
 * Custom hook for chat messaging
 *
 * Provides a unified interface for sending messages, handling streaming responses,
 * and managing the current chat's messages.
 */
import { useState, useCallback, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { create } from "zustand";

import {
  useChatMessages,
  useMessageSubmitSse,
  type MessageSubmitSseVariables,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import type {
  ChatMessage as ApiChatMessage,
  MessageSubmitStreamingResponseMessage,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Message } from "@/types/chat";
import { createSSEConnection, type SSEEvent } from "@/utils/sse/sseClient";

// Streaming state
interface StreamingState {
  isStreaming: boolean;
  currentMessageId: string | null;
  content: string;
}

interface MessagingStore {
  streaming: StreamingState;
  setStreaming: (state: Partial<StreamingState>) => void;
  resetStreaming: () => void;
}

// Initial streaming state
const initialStreamingState: StreamingState = {
  isStreaming: false,
  currentMessageId: null,
  content: "",
};

// Create a store for messaging state
const useMessagingStore = create<MessagingStore>((set) => ({
  streaming: initialStreamingState,
  setStreaming: (state) =>
    set((prev) => ({
      streaming: { ...prev.streaming, ...state },
    })),
  resetStreaming: () => set({ streaming: initialStreamingState }),
}));

export function useChatMessaging(chatId: string | null) {
  const queryClient = useQueryClient();
  const [lastError, setLastError] = useState<Error | null>(null);
  const { streaming, setStreaming, resetStreaming } = useMessagingStore();
  const sseCleanupRef = useRef<(() => void) | null>(null);

  // Skip the query if no chatId is provided
  const skipQuery = !chatId;
  const chatMessagesQuery = useChatMessages(
    skipQuery
      ? { pathParams: { chatId: "" } }
      : { pathParams: { chatId: chatId! } },
    {
      enabled: !skipQuery,
      refetchOnWindowFocus: true,
    },
  );

  // Use the streaming mutation
  const submitMessageMutation = useMessageSubmitSse({
    onError: (error) => {
      console.error("Error sending message:", error);
      setLastError(
        error instanceof Error ? error : new Error("Failed to send message"),
      );
      resetStreaming();
    },
  });

  // Clean up any existing SSE connection on unmount
  useEffect(() => {
    return () => {
      if (sseCleanupRef.current) {
        sseCleanupRef.current();
        sseCleanupRef.current = null;
      }
    };
  }, []);

  // Convert messages from API format to our internal format
  const messages: Message[] =
    chatMessagesQuery.data?.messages.map((msg: ApiChatMessage) => ({
      id: msg.id || `temp-${Date.now()}`,
      content: msg.full_text || "",
      role: msg.role === "user" ? "user" : "assistant",
      createdAt: msg.created_at || new Date().toISOString(),
      status: "complete",
    })) || [];

  // If there's a streaming message in progress, add it to the messages
  if (
    streaming.isStreaming &&
    streaming.currentMessageId &&
    streaming.content
  ) {
    messages.push({
      id: streaming.currentMessageId,
      content: streaming.content,
      role: "assistant",
      createdAt: new Date().toISOString(),
      status: "sending",
    });
  }

  // Handle incoming SSE events
  const processStreamEvent = useCallback(
    (event: SSEEvent) => {
      try {
        const responseData = JSON.parse(
          event.data,
        ) as MessageSubmitStreamingResponseMessage;

        // Handle different message types from SSE
        switch (responseData.message_type) {
          case "text_delta":
            // Append new content to the streaming message
            setStreaming({
              content: streaming.content + responseData.new_text,
            });
            break;

          case "message_complete":
            // Message is complete, update state
            setStreaming({
              isStreaming: false,
              content: responseData.full_text || streaming.content,
            });

            // Update the cache to include the final message
            void queryClient.invalidateQueries({
              queryKey: ["chatMessages", { chatId }],
            });
            break;

          default:
            // For other message types (like chat_created, user_message_saved)
            // No special handling needed for now
            break;
        }
      } catch (err) {
        console.error("Error parsing SSE data:", err, event);
      }
    },
    [chatId, queryClient, setStreaming, streaming.content],
  );

  // Send a message
  const sendMessage = useCallback(
    async (content: string) => {
      if (!chatId) {
        setLastError(new Error("Cannot send message: no active chat"));
        return;
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

        // This is the request format the API expects
        const requestVars: MessageSubmitSseVariables = {
          body: {
            user_message: content,
          },
        };

        // Create a direct SSE connection for streaming
        const sseUrl = `/api/v1beta/me/messages/submitstream?user_message=${encodeURIComponent(content)}`;

        sseCleanupRef.current = createSSEConnection(sseUrl, {
          onMessage: processStreamEvent,
          onError: () => {
            setLastError(new Error("SSE connection error"));
            resetStreaming();
          },
          onClose: () => {
            if (streaming.isStreaming) {
              // If we're still streaming when the connection closes,
              // it was probably an error
              setLastError(new Error("SSE connection closed unexpectedly"));
              resetStreaming();
            }
          },
        });

        // Also invoke the regular mutation to trigger React Query's
        // loading state and error handling
        await submitMessageMutation.mutateAsync(requestVars);

        return streaming.content;
      } catch (error) {
        console.error("Error in sendMessage:", error);
        setLastError(
          error instanceof Error ? error : new Error("Failed to send message"),
        );
        resetStreaming();
        throw error;
      }
    },
    [
      chatId,
      processStreamEvent,
      queryClient,
      resetStreaming,
      setStreaming,
      streaming.content,
      streaming.isStreaming,
      submitMessageMutation,
    ],
  );

  // Cancel the current message stream
  const cancelMessage = useCallback(() => {
    // Clean up SSE connection
    if (sseCleanupRef.current) {
      sseCleanupRef.current();
      sseCleanupRef.current = null;
    }

    resetStreaming();
  }, [resetStreaming]);

  return {
    messages,
    isLoading: chatMessagesQuery.isLoading,
    isStreaming: streaming.isStreaming,
    streamingContent: streaming.content,
    error: lastError || chatMessagesQuery.error,
    sendMessage,
    cancelMessage,
    refetch: chatMessagesQuery.refetch,
  };
}
