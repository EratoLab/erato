"use client";

import { createContext, useContext, useMemo, useState } from "react";

import { useBudgetStatus } from "@/hooks/budget/useBudgetStatus";
import {
  useChatHistory,
  useChatMessaging,
  useModelHistory,
} from "@/hooks/chat";
import { useFileDropzone, useFileUploadStore } from "@/hooks/files";
import { mapMessageToUiMessage } from "@/utils/adapters/messageAdapter";

import type {
  ChatsError,
  ChatMessagesError,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import type { ErrorWrapper } from "@/lib/generated/v1betaApi/v1betaApiFetcher";
import type {
  FileUploadItem,
  ChatModel,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Message } from "@/types/chat";
import type { FileType } from "@/utils/fileTypes";
import type { ReactNode } from "react";

// Constants removed - no longer needed for explicit navigation

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
  archiveChat: (chatId: string) => Promise<void>;
  navigateToChat: (chatId: string) => void;
  refetchHistory: () => Promise<unknown>;

  // Messaging
  messages: Record<string, ChatMessage>;
  messageOrder: string[];
  isStreaming: boolean;
  isFinalizing: boolean;
  streamingContent: string | null;
  isMessagingLoading: boolean;
  messagingError: Error | ChatMessagesError | null;
  sendMessage: (
    content: string,
    inputFileIds?: string[],
    modelId?: string,
    assistantId?: string,
  ) => Promise<string | undefined>;
  editMessage: (
    messageId: string,
    newContent: string,
    replaceInputFileIds?: string[],
  ) => Promise<void>;
  regenerateMessage: (currentMessageId: string) => Promise<void>;
  cancelMessage: () => void;
  refetchMessages: () => Promise<unknown>;

  // File upload
  uploadFiles: (files: File[]) => Promise<FileUploadItem[] | undefined>;
  isUploading: boolean;
  uploadError: Error | string | null;
  uploadedFiles: FileUploadItem[];
  clearUploadedFiles: () => void;

  // Combined states
  isLoading: boolean;
  error: Error | ErrorWrapper<unknown> | null;

  // New state from store
  silentChatId: string | null;

  // New states for mount key logic
  newChatCounter: number;
  mountKey: string | number;

  // Model history (read-only historical context)
  currentChatLastModel: ChatModel | null;
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
    createNewChat: createNewChatFromHistory,
    archiveChat,
    navigateToChat,
    refetch: refetchHistory,
    isNewChatPending,
  } = useChatHistory();

  const [newChatCounter, setNewChatCounter] = useState(0);

  // Use model history hook for historical model information
  const { currentChatLastModel } = useModelHistory({
    currentChatId,
    chats,
  });

  // Custom createNewChat that also increments the counter
  const createNewChat = useMemo(() => {
    return async () => {
      setNewChatCounter((prev) => prev + 1);
      // When a genuinely new chat is created, we expect a new mount key based on the counter.
      // If an existing chat is loaded, and newChatCounter is 0, it uses chatId.
      return createNewChatFromHistory();
    };
  }, [createNewChatFromHistory]);

  // Calculate the mount key based on the amount of new chats created.
  // This allows us to keep the chat component mounted across navigation.
  const mountKey = useMemo(() => {
    return `new-chat-session-${newChatCounter}`;
  }, [newChatCounter]);

  // Get silentChatId directly from the store
  const silentChatId = useFileUploadStore((state) => state.silentChatId);

  // Get the messaging functionality for the current chat
  const {
    messages,
    isLoading: isMessagingLoading,
    isStreaming,
    isFinalizing,
    streamingContent,
    error: messagingError,
    sendMessage,
    editMessage,
    regenerateMessage,
    cancelMessage,
    refetch: refetchMessages,
  } = useChatMessaging({
    chatId: isNewChatPending ? null : currentChatId,
    silentChatId: silentChatId,
  });

  // Removed newlyCreatedChatId store access - now handled in explicit navigation

  // Removed automatic navigation logic - now handled explicitly in message completion

  // Budget/Usage tracking: Initialize on mount and auto-refresh after streaming
  // The query is fetched on mount and automatically refreshed via query invalidation
  // in useChatMessaging's handleRefetchAndClear function after streaming completes.
  useBudgetStatus(); // Fetches on mount, caches result, auto-refreshes after messages

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
    chatId: currentChatId,
    onSilentChatCreated: () => {
      // Callback no longer needed for explicit navigation
    },
  });

  // Combine loading states and errors
  const isLoading = isHistoryLoading || isMessagingLoading;
  const error = historyError ?? messagingError;

  // Memoize the context value to prevent unnecessary re-renders
  const contextValue = useMemo(() => {
    // Transform messages from useChatMessaging to include the "sender" field required by UI components
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- isUserMessage can be undefined based on props type
    const transformedMessages = Object.entries(messages || {}).reduce(
      (acc, [id, msg]) => {
        // Check if this is a streaming message (either actively streaming or completed but waiting for real message)
        const isStreamingMessage =
          msg.role === "assistant" &&
          ((isStreaming && msg.status === "sending") || // Actively streaming
            (!isStreaming &&
              msg.status === "complete" &&
              msg.id.includes("temp-"))); // Streaming completed but placeholder

        if (isStreamingMessage) {
          acc[id] = {
            ...msg,
            sender: msg.role,
            authorId: "assistant_id",
            loading: {
              state: isStreaming ? "typing" : "done", // Keep loading state for auto-scroll
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
      messagesToOrder: Record<string, ChatMessage>,
    ): string[] => {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- isUserMessage can be undefined based on props type
      if (!messagesToOrder || Object.keys(messagesToOrder).length === 0) {
        return [];
      }

      // With the refetch pattern, we prioritize server ordering
      // and just sort by created timestamp for simplicity
      const orderedIds = Object.keys(messagesToOrder).sort((a, b) => {
        const dateA = new Date(messagesToOrder[a].createdAt);
        const dateB = new Date(messagesToOrder[b].createdAt);
        return dateA.getTime() - dateB.getTime();
      });
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
      archiveChat,
      navigateToChat,
      refetchHistory,

      // Messaging
      messages: transformedMessages,
      messageOrder: orderedMessageIds, // Add the ordered message IDs
      isMessagingLoading,
      isStreaming,
      isFinalizing,
      streamingContent,
      messagingError,
      sendMessage,
      editMessage,
      regenerateMessage,
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

      // New state from store
      silentChatId,

      // New states for mount key logic
      newChatCounter,
      mountKey,

      // Model history (read-only historical context)
      currentChatLastModel,
    };
  }, [
    // Chat history dependencies
    chats,
    currentChatId,
    isHistoryLoading,
    historyError,
    createNewChat,
    archiveChat,
    navigateToChat,
    refetchHistory,

    // Messaging dependencies
    messages,
    isMessagingLoading,
    isStreaming,
    isFinalizing,
    streamingContent,
    messagingError,
    sendMessage,
    editMessage,
    regenerateMessage,
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

    // New state from store
    silentChatId,

    // New states for mount key logic
    newChatCounter,
    mountKey,

    // Model history dependencies
    currentChatLastModel,
  ]);

  return (
    <ChatContext.Provider value={contextValue}>{children}</ChatContext.Provider>
  );
}
