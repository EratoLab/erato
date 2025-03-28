/**
 * Core messaging hook that provides a simple interface for messaging functionality
 */
import { useCallback } from "react";
import { v4 as uuidv4 } from "uuid";

import { useMessageStore } from "@/state/messaging/store";

import { useStreamingAPI } from "./useStreamingAPI";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Message } from "@/state/types/message.types";

/**
 * Optional configuration for message creation
 */
interface MessageOptions {
  /** Additional metadata to store with the message */
  metadata?: Record<string, unknown>;
}

/**
 * Options for sending a message
 */
interface SendMessageOptions {
  /** Files to attach to the message */
  fileIds?: string[];
  /** Previous message ID for context */
  previousMessageId?: string;
  /** Callback when streaming starts */
  onStart?: (messageId: string) => void;
  /** Callback when streaming completes */
  onComplete?: (messageId: string, content: string) => void;
  /** Callback when streaming encounters an error */
  onError?: (messageId: string, error: Error) => void;
}

/**
 * Hook that provides messaging functionality for a specific chat
 */
export function useMessaging(chatId: string) {
  // Access the store state and actions
  const {
    messages,
    messageOrder,
    setCurrentChatId,
    addMessage,
    updateMessage,
    streaming,
  } = useMessageStore();

  // Use the streaming API hook
  const { streamMessage, cancelStream, isStreaming } = useStreamingAPI();

  /**
   * Set the current active chat
   */
  const setActiveChat = useCallback(
    (id: string | null) => {
      setCurrentChatId(id);
    },
    [setCurrentChatId],
  );

  /**
   * Create a user message
   */
  const createUserMessage = useCallback(
    (
      content: string,
      fileAttachments?: FileUploadItem[],
      options?: MessageOptions,
    ) => {
      const id = uuidv4();
      const now = new Date();

      const message: Message = {
        id,
        content,
        sender: "user",
        createdAt: now,
        status: "complete",
        attachments: fileAttachments,
        metadata: options?.metadata,
      };

      addMessage(message);
      return id;
    },
    [addMessage],
  );

  /**
   * Create an assistant message (initially in pending state)
   */
  const createAssistantMessage = useCallback(
    (options?: MessageOptions) => {
      const id = uuidv4();
      const now = new Date();

      const message: Message = {
        id,
        content: "",
        sender: "assistant",
        createdAt: now,
        status: "pending",
        metadata: options?.metadata,
      };

      addMessage(message);
      return id;
    },
    [addMessage],
  );

  /**
   * Send a message and handle the streaming response
   */
  const sendMessage = useCallback(
    async (content: string, options?: SendMessageOptions) => {
      if (
        !content.trim() &&
        (!options?.fileIds || options.fileIds.length === 0)
      ) {
        return;
      }

      // Ensure current chat is set
      if (chatId) {
        setCurrentChatId(chatId);
      }

      // Create the user message
      const userMessageId = createUserMessage(content);

      // Create the assistant message (initially in pending state)
      const assistantMessageId = createAssistantMessage();

      // Notify start if callback provided
      options?.onStart?.(assistantMessageId);

      try {
        // Start streaming
        await streamMessage(
          chatId,
          assistantMessageId,
          content,
          options?.previousMessageId,
          options?.fileIds,
          {
            onComplete: (fullContent) => {
              options?.onComplete?.(assistantMessageId, fullContent);
            },
            onError: (error) => {
              options?.onError?.(assistantMessageId, error);
            },
          },
        );
      } catch (error) {
        console.error("Error sending message:", error);
        updateMessage(assistantMessageId, {
          status: "error",
          error:
            error instanceof Error
              ? error
              : new Error("Failed to send message"),
        });
      }

      return { userMessageId, assistantMessageId };
    },
    [
      chatId,
      setCurrentChatId,
      createUserMessage,
      createAssistantMessage,
      streamMessage,
      updateMessage,
    ],
  );

  /**
   * Cancel the current streaming message
   */
  const cancelMessage = useCallback(() => {
    if (streaming.messageId) {
      cancelStream(streaming.messageId);
    }
  }, [cancelStream, streaming.messageId]);

  return {
    // State
    messages,
    messageOrder,
    isStreaming,
    currentStreamingMessageId: streaming.messageId,
    streamingStatus: streaming.status,

    // Actions
    sendMessage,
    cancelMessage,
    setActiveChat,
  };
}
