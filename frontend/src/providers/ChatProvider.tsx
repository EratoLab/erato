"use client";

import { createContext, useContext, useMemo, useEffect } from "react";

import { useChatHistory, useChatMessaging } from "@/hooks/chat";
import { useFileDropzone } from "@/hooks/files";
import { mapMessageToUiMessage } from "@/utils/adapters/messageAdapter";

import type {
  ChatsError,
  ChatMessagesError,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import type { ErrorWrapper } from "@/lib/generated/v1betaApi/v1betaApiFetcher";
import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Message } from "@/types/chat";
import type { FileType } from "@/utils/fileTypes";
import type { ReactNode } from "react";

// Define the ChatMessage type used by UI components
interface ChatMessage extends Message {
  sender: string;
  authorId: string;
  previous_message_id?: string;
  loading?: {
    state: "typing" | "thinking" | "done" | "error";
    context?: string;
  };
}

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
  messages: Record<string, ChatMessage>;
  messageOrder: string[];
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
    isNewChatPending,
  } = useChatHistory();

  // Add specific logging when currentChatId changes
  useEffect(() => {
    console.log(
      `[CHAT_FLOW] ChatProvider - currentChatId changed to: ${currentChatId ?? "null"}, newChatPending: ${isNewChatPending}`,
    );
  }, [currentChatId, isNewChatPending]);

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
  } = useChatMessaging({
    // Only pass the chatId if we're not creating a new chat
    // This prevents unwanted reloads of previous chat data
    chatId: isNewChatPending ? null : currentChatId,
    onChatCreated: (newChatId: string) => {
      // Only log in development
      if (process.env.NODE_ENV === "development") {
        console.log("[CHAT_FLOW] Navigating to chat:", newChatId);
      }

      // Directly navigate to the chat - the callback is only called when it's safe to do so
      navigateToChat(newChatId);
    },
  });

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
  const contextValue = useMemo(() => {
    // Debug log to track message lifecycle
    if (process.env.NODE_ENV === "development") {
      console.log(
        "[CHAT_PROVIDER] Creating context with messages:",
        Object.keys(messages || {}).length,
        "messages from useChatMessaging",
      );
    }

    // Transform messages from useChatMessaging to include the "sender" field required by UI components
    const transformedMessages = Object.entries(messages || {}).reduce(
      (acc, [id, msg]) => {
        // Skip transformation for streaming messages if they're already being streamed
        // This prevents unnecessary processing during high-frequency updates
        if (
          isStreaming &&
          msg.status === "sending" &&
          msg.role === "assistant"
        ) {
          acc[id] = {
            ...msg,
            sender: msg.role,
            authorId: "assistant_id",
            loading: {
              state: "typing",
            },
          };
        } else {
          acc[id] = mapMessageToUiMessage(msg);
        }
        return acc;
      },
      {} as Record<string, ChatMessage>,
    );

    // Create a properly ordered message array based on previous_message_id relationships
    const createMessageOrder = (
      messages: Record<string, ChatMessage>,
    ): string[] => {
      if (!messages || Object.keys(messages).length === 0) return [];

      // With the refetch pattern, we prioritize server ordering
      // and just sort by created timestamp for simplicity
      return Object.keys(messages).sort((a, b) => {
        const dateA = new Date(messages[a].createdAt);
        const dateB = new Date(messages[b].createdAt);
        return dateA.getTime() - dateB.getTime();
      });
    };

    // Create the message order
    const orderedMessageIds = createMessageOrder(transformedMessages);

    return {
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
      messages: transformedMessages,
      messageOrder: orderedMessageIds, // Add the ordered message IDs
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
    };
  }, [
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
  ]);

  return (
    <ChatContext.Provider value={contextValue}>{children}</ChatContext.Provider>
  );
}
