"use client";

import { createContext, useContext, useMemo } from "react";

import { useChatHistory, useChatMessaging } from "@/hooks/chat";
import { useFileDropzone } from "@/hooks/files";

import type {
  ChatsError,
  ChatMessagesError,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import type { ErrorWrapper } from "@/lib/generated/v1betaApi/v1betaApiFetcher";
import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { FileType } from "@/utils/fileTypes";
import type { ReactNode } from "react";

interface ChatContextValue {
  // Chat history
  chats: ReturnType<typeof useChatHistory>["chats"];
  currentChatId: string | null;
  isHistoryLoading: boolean;
  historyError: ChatsError | null;
  createNewChat: () => Promise<string>;
  deleteChat: (chatId: string) => Promise<void>;
  navigateToChat: (chatId: string) => void;
  refetchHistory: () => Promise<unknown>;

  // Messaging
  messages: ReturnType<typeof useChatMessaging>["messages"];
  isStreaming: boolean;
  streamingContent: string | null;
  isMessagingLoading: boolean;
  messagingError: Error | ChatMessagesError | null;
  sendMessage: (content: string) => Promise<string | undefined>;
  cancelMessage: () => void;
  refetchMessages: () => Promise<unknown>;

  // File upload
  uploadFiles: (files: File[]) => Promise<void>;
  isUploading: boolean;
  uploadError: Error | string | null;
  uploadedFiles: FileUploadItem[];
  clearUploadedFiles: () => void;

  // Combined states
  isLoading: boolean;
  error: Error | ErrorWrapper<unknown> | null;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export const useChatContext = () => {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChatContext must be used within a ChatProvider");
  }
  return context;
};

interface ChatProviderProps {
  children: ReactNode;
  acceptedFileTypes?: FileType[];
}

export function ChatProvider({
  children,
  acceptedFileTypes = [],
}: ChatProviderProps) {
  // Get the chat history functionality
  const {
    chats,
    currentChatId,
    isLoading: isHistoryLoading,
    error: historyError,
    createNewChat,
    deleteChat,
    navigateToChat,
    refetch: refetchHistory,
  } = useChatHistory();

  // Get the messaging functionality for the current chat
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

  // Get file upload functionality
  const {
    uploadFiles,
    isUploading,
    uploadedFiles,
    error: uploadError,
    clearFiles: clearUploadedFiles,
  } = useFileDropzone({
    acceptedFileTypes,
    multiple: true,
  });

  // Combine loading states and errors
  const isLoading = isHistoryLoading || isMessagingLoading;
  const error = historyError || messagingError;

  // Memoize the context value to prevent unnecessary re-renders
  const contextValue = useMemo(
    () => ({
      // Chat history
      chats,
      currentChatId,
      isHistoryLoading,
      historyError,
      createNewChat,
      deleteChat,
      navigateToChat,
      refetchHistory,

      // Messaging
      messages,
      isMessagingLoading,
      isStreaming,
      streamingContent,
      messagingError,
      sendMessage,
      cancelMessage,
      refetchMessages,

      // File upload
      uploadFiles,
      isUploading,
      uploadedFiles,
      uploadError,
      clearUploadedFiles,

      // Combined states
      isLoading,
      error,
    }),
    [
      // Chat history dependencies
      chats,
      currentChatId,
      isHistoryLoading,
      historyError,
      createNewChat,
      deleteChat,
      navigateToChat,
      refetchHistory,

      // Messaging dependencies
      messages,
      isMessagingLoading,
      isStreaming,
      streamingContent,
      messagingError,
      sendMessage,
      cancelMessage,
      refetchMessages,

      // File upload dependencies
      uploadFiles,
      isUploading,
      uploadedFiles,
      uploadError,
      clearUploadedFiles,

      // Combined states
      isLoading,
      error,
    ],
  );

  return (
    <ChatContext.Provider value={contextValue}>{children}</ChatContext.Provider>
  );
}
