/**
 * Custom hook for chat messaging
 *
 * Provides a unified interface for sending messages, handling streaming responses,
 * and managing the current chat's messages.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useState, useCallback } from "react";
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

// Define types for SSE events
interface SSEEvent {
  data: string;
  type: string;
  id?: string;
}

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

        // Send the message using SSE
        // Note: In a real implementation, we would register the processStreamEvent
        // as an event handler for the SSE stream
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
      resetStreaming,
      setStreaming,
      streaming.content,
      submitMessageMutation,
    ],
  );

  // Cancel the current message stream
  const cancelMessage = useCallback(() => {
    // Current implementation doesn't support abort directly
    // Just reset the streaming state for now
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
    processStreamEvent,
  };
}
