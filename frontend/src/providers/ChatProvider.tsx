"use client";

import { createContext, useContext, useMemo, useEffect, useState } from "react";

import { useChatHistory, useChatMessaging } from "@/hooks/chat";
import { useMessagingStore } from "@/hooks/chat/store/messagingStore";
import { useFileDropzone, useFileUploadStore } from "@/hooks/files";
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
  archiveChat: (chatId: string) => Promise<void>;
  navigateToChat: (chatId: string) => void;
  refetchHistory: () => Promise<unknown>;

  // Messaging
  messages: Record<string, ChatMessage>;
  messageOrder: string[];
  isStreaming: boolean;
  streamingContent: string | null;
  isMessagingLoading: boolean;
  messagingError: Error | ChatMessagesError | null;
  sendMessage: (
    content: string,
    inputFileIds?: string[],
  ) => Promise<string | undefined>;
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
  const setStoreSilentChatId = useFileUploadStore(
    (state) => state.setSilentChatId,
  ); // Get setter to clear it

  // Add specific logging when currentChatId changes
  useEffect(() => {
    console.log(
      `[DEBUG_REDIRECT] ChatProvider - currentChatId changed to: ${currentChatId ?? "null"}, newChatPending: ${isNewChatPending}`,
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
    chatId: isNewChatPending ? null : currentChatId,
    silentChatId: silentChatId,
  });

  // Get newlyCreatedChatId from the store
  const newlyCreatedChatIdFromStore = useMessagingStore(
    (state) => state.newlyCreatedChatId,
  );
  const setNewlyCreatedChatIdInStore = useMessagingStore(
    (state) => state.setNewlyCreatedChatIdInStore,
  );

  // Add Effect to handle navigation when a new chat is created and streaming stops
  useEffect(() => {
    const storeIsStreaming = useMessagingStore.getState().streaming.isStreaming;
    const storeIsAwaitingFirstChunk =
      useMessagingStore.getState().isAwaitingFirstStreamChunkForNewChat;

    if (process.env.NODE_ENV === "development") {
      console.log(
        `[DEBUG_REDIRECT] ChatProvider: Navigation check. newlyCreatedChatIdFromStore: ${newlyCreatedChatIdFromStore}, hookIsStreaming: ${isStreaming}, storeIsStreaming: ${storeIsStreaming}, storeIsAwaitingFirstChunk: ${storeIsAwaitingFirstChunk}`,
      );
    }
    if (
      newlyCreatedChatIdFromStore &&
      !isStreaming &&
      !storeIsAwaitingFirstChunk
    ) {
      console.log(
        `[DEBUG_REDIRECT] ChatProvider: Navigating due to newlyCreatedChatIdFromStore: ${newlyCreatedChatIdFromStore}, !hookIsStreaming (${isStreaming}), and !storeIsAwaitingFirstChunk (${storeIsAwaitingFirstChunk}).`,
      );

      const chatIdToNavigateTo = newlyCreatedChatIdFromStore;

      console.log(
        "[DEBUG_REDIRECT] ChatProvider: Resetting silentChatId in store before navigation.",
      );
      setStoreSilentChatId(null);

      setTimeout(() => {
        console.log(
          `[DEBUG_REDIRECT] ChatProvider: Navigating to new chat (inside setTimeout): ${chatIdToNavigateTo}`,
        );
        navigateToChat(chatIdToNavigateTo);
        // Clear newlyCreatedChatId from store after navigation attempt
        console.log(
          `[DEBUG_REDIRECT] ChatProvider: Clearing newlyCreatedChatIdFromStore (${chatIdToNavigateTo}) from store after navigation.`,
        );
        setNewlyCreatedChatIdInStore(null);
      }, 100);
    }
  }, [
    newlyCreatedChatIdFromStore,
    isStreaming,
    navigateToChat,
    setStoreSilentChatId,
    setNewlyCreatedChatIdInStore,
  ]);

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
    onSilentChatCreated: (newChatId) => {
      console.log(
        "[CHAT_PROVIDER] Received onSilentChatCreated callback (unused now):",
        newChatId,
      );
    },
  });

  // Combine loading states and errors
  const isLoading = isHistoryLoading || isMessagingLoading;
  const error = historyError ?? messagingError;

  // Add useEffect hooks to log dependency changes for contextValue's useMemo
  // useEffect(() => {
  //   if (process.env.NODE_ENV === "development") {
  //     // console.log("[CHAT_PROVIDER_DEPS] chats changed:", chats);
  //   }
  // }, [chats]);

  // useEffect(() => {
  //   if (process.env.NODE_ENV === "development") {
  //     // console.log(
  //     //   "[CHAT_PROVIDER_DEPS] currentChatId (for context deps) changed:",
  //     //   currentChatId,
  //     // );
  //   }
  // }, [currentChatId]);

  // useEffect(() => {
  //   if (process.env.NODE_ENV === "development") {
  //     // console.log(
  //     //   "[CHAT_PROVIDER_DEPS] isHistoryLoading changed:",
  //     //   isHistoryLoading,
  //     // );
  //   }
  // }, [isHistoryLoading]);

  // useEffect(() => {
  //   if (process.env.NODE_ENV === "development") {
  //     // console.log("[CHAT_PROVIDER_DEPS] historyError changed:", historyError);
  //   }
  // }, [historyError]);

  // useEffect(() => {
  //   if (process.env.NODE_ENV === "development") {
  //     // console.log(
  //     //   "[CHAT_PROVIDER_DEPS] createNewChat changed (should be stable)",
  //     // );
  //   }
  // }, [createNewChat]); // createNewChat is memoized, should not change often

  // useEffect(() => {
  //   if (process.env.NODE_ENV === "development") {
  //     // console.log(
  //     //   "[CHAT_PROVIDER_DEPS] archiveChat changed (should be stable)",
  //     // );
  //   }
  // }, [archiveChat]); // archiveChat is from a hook, likely stable

  // useEffect(() => {
  //   if (process.env.NODE_ENV === "development") {
  //     // console.log(
  //     //   "[CHAT_PROVIDER_DEPS] navigateToChat changed (should be stable)",
  //     // );
  //   }
  // }, [navigateToChat]); // navigateToChat is from a hook, likely stable

  // useEffect(() => {
  //   if (process.env.NODE_ENV === "development") {
  //     // console.log(
  //     //   "[CHAT_PROVIDER_DEPS] refetchHistory changed (should be stable)",
  //     // );
  //   }
  // }, [refetchHistory]); // refetchHistory is from a hook, likely stable

  // useEffect(() => {
  //   if (process.env.NODE_ENV === "development") {
  //     // console.log("[CHAT_PROVIDER_DEPS] messages changed:", messages);
  //   }
  // }, [messages]);

  // useEffect(() => {
  //   if (process.env.NODE_ENV === "development") {
  //     // console.log(
  //     //   "[CHAT_PROVIDER_DEPS] isMessagingLoading changed:",
  //     //   isMessagingLoading,
  //     // );
  //   }
  // }, [isMessagingLoading]);

  // useEffect(() => {
  //   if (process.env.NODE_ENV === "development") {
  //     // console.log("[CHAT_PROVIDER_DEPS] isStreaming changed:", isStreaming);
  //   }
  // }, [isStreaming]);

  // useEffect(() => {
  //   if (process.env.NODE_ENV === "development") {
  //     // console.log(
  //     //   "[CHAT_PROVIDER_DEPS] streamingContent changed:",
  //     //   streamingContent,
  //     // );
  //   }
  // }, [streamingContent]);

  // useEffect(() => {
  //   if (process.env.NODE_ENV === "development") {
  //     // console.log(
  //     //   "[CHAT_PROVIDER_DEPS] messagingError changed:",
  //     //   messagingError,
  //     // );
  //   }
  // }, [messagingError]);

  // useEffect(() => {
  //   if (process.env.NODE_ENV === "development") {
  //     // console.log(
  //     //   "[CHAT_PROVIDER_DEPS] sendMessage changed (should be stable)",
  //     // );
  //   }
  // }, [sendMessage]); // sendMessage is from a hook, likely stable

  // useEffect(() => {
  //   if (process.env.NODE_ENV === "development") {
  //     // console.log(
  //     //   "[CHAT_PROVIDER_DEPS] cancelMessage changed (should be stable)",
  //     // );
  //   }
  // }, [cancelMessage]); // cancelMessage is from a hook, likely stable

  // useEffect(() => {
  //   if (process.env.NODE_ENV === "development") {
  //     // console.log(
  //     //   "[CHAT_PROVIDER_DEPS] refetchMessages changed (should be stable)",
  //     // );
  //   }
  // }, [refetchMessages]); // refetchMessages is from a hook, likely stable

  // useEffect(() => {
  //   if (process.env.NODE_ENV === "development") {
  //     // console.log(
  //     //   "[CHAT_PROVIDER_DEPS] uploadFiles changed (should be stable)",
  //     // );
  //   }
  // }, [uploadFiles]); // uploadFiles is from a hook, likely stable

  // useEffect(() => {
  //   if (process.env.NODE_ENV === "development") {
  //     // console.log("[CHAT_PROVIDER_DEPS] isUploading changed:", isUploading);
  //   }
  // }, [isUploading]);

  // useEffect(() => {
  //   if (process.env.NODE_ENV === "development") {
  //     // console.log("[CHAT_PROVIDER_DEPS] uploadedFiles changed:", uploadedFiles);
  //   }
  // }, [uploadedFiles]);

  // useEffect(() => {
  //   if (process.env.NODE_ENV === "development") {
  //     // console.log("[CHAT_PROVIDER_DEPS] uploadError changed:", uploadError);
  //   }
  // }, [uploadError]);

  // useEffect(() => {
  //   if (process.env.NODE_ENV === "development") {
  //     // console.log(
  //     //   "[CHAT_PROVIDER_DEPS] clearUploadedFiles changed (should be stable)",
  //     // );
  //   }
  // }, [clearUploadedFiles]); // clearUploadedFiles is from a hook, likely stable

  // useEffect(() => {
  //   if (process.env.NODE_ENV === "development") {
  //     // console.log(
  //     //   "[CHAT_PROVIDER_DEPS] isLoading derived state changed:",
  //     //   isLoading,
  //     // );
  //   }
  // }, [isLoading]); // This is a derived state, will change if its constituents change

  // useEffect(() => {
  //   if (process.env.NODE_ENV === "development") {
  //     // console.log("[CHAT_PROVIDER_DEPS] error derived state changed:", error);
  //   }
  // }, [error]); // This is a derived state, will change if its constituents change

  // useEffect(() => {
  //   if (process.env.NODE_ENV === "development") {
  //     // console.log("[CHAT_PROVIDER_DEPS] silentChatId changed:", silentChatId);
  //     console.log(
  //       "[DEBUG_REDIRECT] ChatProvider: silentChatId from store changed to:",
  //       silentChatId,
  //     );
  //   }
  // }, [silentChatId]);

  // useEffect(() => {
  //   if (process.env.NODE_ENV === "development") {
  //     // console.log(
  //     //   "[CHAT_PROVIDER_DEPS] newChatCounter changed:",
  //     //   newChatCounter,
  //     // );
  //     console.log(
  //       "[DEBUG_REDIRECT] ChatProvider: newChatCounter changed to:",
  //       newChatCounter,
  //     );
  //   }
  // }, [newChatCounter]);

  // useEffect(() => {
  //   if (process.env.NODE_ENV === "development") {
  //     // console.log("[CHAT_PROVIDER_DEPS] mountKey changed:", mountKey);
  //     console.log(
  //       "[DEBUG_REDIRECT] ChatProvider: mountKey changed to:",
  //       mountKey,
  //     );
  //   }
  // }, [mountKey]);

  // Memoize the context value to prevent unnecessary re-renders
  const contextValue = useMemo(() => {
    // Debug log to track message lifecycle
    if (process.env.NODE_ENV === "development") {
      const storeStreamingState = useMessagingStore.getState().streaming;
      console.log("[DEBUG_STREAMING] ChatProvider: Creating contextValue.", {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        inputMessagesCount: Object.keys(messages || {}).length,
        hookIsStreaming: isStreaming,
        hookStreamingContent: streamingContent
          ? streamingContent.substring(0, 50) + "..."
          : null,
        storeIsStreaming: storeStreamingState.isStreaming,
        storeCurrentMessageId: storeStreamingState.currentMessageId,
        storeStreamingContent: storeStreamingState.content
          ? storeStreamingState.content.substring(0, 50) + "..."
          : null,
        currentChatIdFromProvider: currentChatId, // Log currentChatId here too
      });
    }

    // Transform messages from useChatMessaging to include the "sender" field required by UI components
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- isUserMessage can be undefined based on props type
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
      messagesToOrder: Record<string, ChatMessage>,
    ): string[] => {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- isUserMessage can be undefined based on props type
      if (!messagesToOrder || Object.keys(messagesToOrder).length === 0) {
        console.log(
          "[DEBUG_STREAMING] ChatProvider createMessageOrder: No messages to order.",
        );
        return [];
      }

      // With the refetch pattern, we prioritize server ordering
      // and just sort by created timestamp for simplicity
      const orderedIds = Object.keys(messagesToOrder).sort((a, b) => {
        const dateA = new Date(messagesToOrder[a].createdAt);
        const dateB = new Date(messagesToOrder[b].createdAt);
        return dateA.getTime() - dateB.getTime();
      });
      if (process.env.NODE_ENV === "development") {
        console.log(
          "[DEBUG_STREAMING] ChatProvider createMessageOrder: Ordered IDs count:",
          orderedIds.length,
        );
      }
      return orderedIds;
    };

    // Create the message order
    const orderedMessageIds = createMessageOrder(transformedMessages);
    if (process.env.NODE_ENV === "development") {
      console.log(
        "[DEBUG_STREAMING] ChatProvider contextValue: Transformed messages count:",
        Object.keys(transformedMessages).length,
        "Ordered IDs count:",
        orderedMessageIds.length,
      );
    }

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

      // New state from store
      silentChatId,

      // New states for mount key logic
      newChatCounter,
      mountKey,
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

    // New state from store
    silentChatId,

    // New states for mount key logic
    newChatCounter,
    mountKey,
  ]);

  return (
    <ChatContext.Provider value={contextValue}>{children}</ChatContext.Provider>
  );
}
