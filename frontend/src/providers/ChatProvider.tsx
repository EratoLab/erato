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
  } = useChatMessaging({
    chatId: currentChatId,
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
    // Transform messages from useChatMessaging to include the "sender" field required by UI components
    const transformedMessages = Object.entries(messages || {}).reduce(
      (acc, [id, msg]) => {
        acc[id] = {
          ...msg,
          sender: msg.role, // Map the role property to sender
          authorId: msg.role === "user" ? "user_id" : "assistant_id", // Set default authorId
        };
        return acc;
      },
      {} as Record<string, ChatMessage>,
    );

    // Create a properly ordered message array based on previous_message_id relationships
    const createMessageOrder = (
      messages: Record<string, ChatMessage>,
    ): string[] => {
      if (!messages || Object.keys(messages).length === 0) return [];

      // Create a map of previous_message_id to message_id
      const childMap: Record<string, string[]> = {};
      const messageIds = Object.keys(messages);

      // Track messages with no previous_message_id (root messages)
      const rootMessageIds: string[] = [];

      // Build the relationship map
      messageIds.forEach((id) => {
        const msg = messages[id];
        if (!msg.previous_message_id) {
          rootMessageIds.push(id);
        } else {
          const prevId = msg.previous_message_id;
          if (!childMap[prevId]) {
            childMap[prevId] = [];
          }
          childMap[prevId].push(id);
        }
      });

      // Build the ordered list starting from root messages
      const orderedIds: string[] = [];

      // Sort root messages by createdAt (oldest first)
      rootMessageIds.sort((a, b) => {
        const dateA = new Date(messages[a].createdAt);
        const dateB = new Date(messages[b].createdAt);
        return dateA.getTime() - dateB.getTime();
      });

      // Recursively add messages in the correct order
      const addToOrder = (id: string) => {
        orderedIds.push(id);
        if (childMap[id]) {
          // If multiple children, sort by creation date
          childMap[id].sort((a, b) => {
            const dateA = new Date(messages[a].createdAt);
            const dateB = new Date(messages[b].createdAt);
            return dateA.getTime() - dateB.getTime();
          });
          childMap[id].forEach((childId) => addToOrder(childId));
        }
      };

      rootMessageIds.forEach((id) => addToOrder(id));

      return orderedIds;
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
