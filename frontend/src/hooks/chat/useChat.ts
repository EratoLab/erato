/**
 * Main chat hook that combines messaging and history functionality
 *
 * This hook is the main entry point for chat functionality in the application.
 * It integrates the chat history and messaging hooks to provide a unified interface.
 */
import { useMemo } from "react";

import { useChatHistory } from "./useChatHistory";
import { useChatMessaging } from "./useChatMessaging";

export function useChat() {
  // Get chat history functionality
  const {
    chats,
    currentChatId,
    isLoading: isHistoryLoading,
    error: historyError,
    createNewChat,
    navigateToChat,
    refetch: refetchHistory,
  } = useChatHistory();

  // Get chat messaging functionality for the current chat
  const {
    messages,
    isLoading: isMessagingLoading,
    isStreaming,
    streamingContent,
    error: messagingError,
    sendMessage,
    cancelMessage,
    refetch: refetchMessages,
  } = useChatMessaging(currentChatId);

  // Combine loading states and errors
  const isLoading = isHistoryLoading || isMessagingLoading;
  const error = historyError ?? messagingError;

  // Memoize the combined result
  const result = useMemo(
    () => ({
      // History-related
      chats,
      currentChatId,
      createNewChat,
      navigateToChat,
      refetchHistory,

      // Messaging-related
      messages,
      isStreaming,
      streamingContent,
      sendMessage,
      cancelMessage,
      refetchMessages,

      // Combined states
      isLoading,
      error,
    }),
    [
      chats,
      currentChatId,
      createNewChat,
      navigateToChat,
      refetchHistory,
      messages,
      isStreaming,
      streamingContent,
      sendMessage,
      cancelMessage,
      refetchMessages,
      isLoading,
      error,
    ],
  );

  return result;
}
