/**
 * Provider component for messaging functionality with improved state management
 */
import { useQueryClient } from "@tanstack/react-query";
import React, { createContext, useContext, useEffect, useMemo } from "react";

import { useMessaging } from "@/hooks/core/useMessaging";
import { useMessageStore } from "@/state/messaging/store";

import type { Message } from "@/state/types/message.types";
import type { StreamingStatus } from "@/state/types/streaming.types";

/**
 * Options for sending a message through the context
 */
export interface SendMessageOptions {
  /** Files to attach to the message */
  fileIds?: string[];
  /** Previous message ID for context */
  previousMessageId?: string;
}

/**
 * MessagingContext holds all chat messaging functionality
 */
interface MessagingContextValue {
  // State
  messages: Record<string, Message>;
  messageOrder: string[];
  isStreaming: boolean;
  streamingStatus: StreamingStatus;
  currentStreamingMessageId: string | null;

  // Actions
  sendMessage: (
    content: string,
    options?: SendMessageOptions,
  ) => Promise<
    | {
        userMessageId: string;
        assistantMessageId: string;
      }
    | undefined
  >;
  cancelMessage: () => void;
}

// Create the messaging context
const MessagingContext = createContext<MessagingContextValue | undefined>(
  undefined,
);

/**
 * Props for the MessagingProvider component
 */
interface MessagingProviderProps {
  /** The chat ID to use for this messaging session */
  chatId: string;
  /** Child components that will have access to the messaging context */
  children: React.ReactNode;
  /** Optional callback for when a new chat is created */
  _onChatCreated?: (tempId: string, permanentId: string) => void;
  /** Optional initial messages to populate the store with */
  initialMessages?: Record<string, Message>;
  /** Optional initial message order */
  _initialMessageOrder?: string[];
}

/**
 * Provider component that makes messaging functionality available to its children.
 * This is a replacement for the existing MessageStreamProvider with improved state management.
 */
export function MessagingProvider({
  chatId,
  children,
  _onChatCreated,
  initialMessages = {},
  _initialMessageOrder = [],
}: MessagingProviderProps) {
  // Access the message store directly for initialization
  const resetMessages = useMessageStore((state) => state.resetMessages);
  const addMessage = useMessageStore((state) => state.addMessage);

  // Get query client for cache invalidation
  const queryClient = useQueryClient();

  // Get messaging functionality for this chat
  const {
    messages,
    messageOrder,
    isStreaming,
    streamingStatus,
    currentStreamingMessageId,
    sendMessage: baseSendMessage,
    cancelMessage,
    setActiveChat,
  } = useMessaging(chatId);

  // Set the active chat when the chatId changes
  useEffect(() => {
    setActiveChat(chatId);
  }, [chatId, setActiveChat]);

  // Initialize with initial messages if provided
  useEffect(() => {
    // Reset the store first
    resetMessages();

    // Add each initial message to the store
    if (initialMessages && Object.keys(initialMessages).length > 0) {
      Object.values(initialMessages).forEach((message) => {
        addMessage(message);
      });
    }
    // Only run this on first mount or when explicitly changing chat
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wrap sendMessage to handle chat creation
  const sendMessage = useMemo(() => {
    return async (content: string, options?: SendMessageOptions) => {
      const result = await baseSendMessage(content, {
        ...options,
        onComplete: (_messageId, _fullContent) => {
          // Invalidate queries to refresh data
          void queryClient.invalidateQueries({
            queryKey: ["recentChats"],
          });
        },
      });

      return result;
    };
  }, [baseSendMessage, queryClient]);

  // Create the context value
  const contextValue = useMemo(
    () => ({
      // State
      messages,
      messageOrder,
      isStreaming,
      streamingStatus,
      currentStreamingMessageId,

      // Actions
      sendMessage,
      cancelMessage,
    }),
    [
      messages,
      messageOrder,
      isStreaming,
      streamingStatus,
      currentStreamingMessageId,
      sendMessage,
      cancelMessage,
    ],
  );

  return (
    <MessagingContext.Provider value={contextValue}>
      {children}
    </MessagingContext.Provider>
  );
}

/**
 * Hook to access the messaging context
 */
export function useMessagingContext() {
  const context = useContext(MessagingContext);

  if (!context) {
    throw new Error(
      "useMessagingContext must be used within a MessagingProvider",
    );
  }

  return context;
}
