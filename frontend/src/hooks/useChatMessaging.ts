import { useCallback, useMemo, useRef } from "react";

import { useMessagingContext } from "@/components/containers/MessagingProvider";

import { useFileUpload } from "./useFileUpload";

import type { ChatMessage } from "@/components/containers/ChatProvider";

// Helper to generate unique IDs
export const generateMessageId = () => crypto.randomUUID();

/**
 * Hook to manage chat messaging functionality
 */
export function useChatMessaging(
  messageOrder: string[],
  addMessage: (message: ChatMessage) => void,
  updateMessage: (messageId: string, updates: Partial<ChatMessage>) => void,
) {
  // Use the new messaging context
  const { sendMessage: contextSendMessage } = useMessagingContext();

  // Reference for tracking the last created assistant message
  const lastAssistantMessageRef = useRef<string | null>(null);

  // Use useMemo to create a stable messageFilesRef object
  const messageFilesRef = useMemo(
    () => ({ current: [] as { id: string; filename: string }[] }),
    [],
  );

  const {
    uploadFiles,
    isUploading: isUploadingFiles,
    error: uploadError,
  } = useFileUpload({
    onUploadSuccess: (files) => {
      // Store the files for the next message
      messageFilesRef.current = files.map((file) => ({
        id: file.id,
        filename: file.filename,
      }));
    },
    onUploadError: (error) => {
      console.error("File upload error:", error);
    },
  });

  // Function to handle file attachments for a message
  const handleFileAttachments = (files: { id: string; filename: string }[]) => {
    // Store the files for the next message
    messageFilesRef.current = files;
  };

  // Expose the uploadFiles function
  const performFileUpload = (files: File[]) => {
    return uploadFiles(files);
  };

  // Send a message and handle streaming
  const sendMessage = useCallback(
    async (content: string, _sessionId: string): Promise<void> => {
      if (!content.trim() && !messageFilesRef.current.length) {
        return; // Don't send empty messages without attachments
      }

      // Generate a unique ID for the new messages
      const userMessageId = generateMessageId();
      const assistantMessageId = generateMessageId();

      // Store the assistant message ID for tracking
      lastAssistantMessageRef.current = assistantMessageId;

      // Get the current time for message creation
      const now = new Date();

      // Get the last message ID, if any
      let lastMessageId: string | undefined;
      if (messageOrder.length > 0) {
        lastMessageId = messageOrder[messageOrder.length - 1];
      }

      // Create the user message with any attached files
      const userMessage: ChatMessage = {
        id: userMessageId,
        content,
        sender: "user",
        createdAt: now,
        authorId: "user",
        attachments: messageFilesRef.current,
      };

      // Clear the attached files for future messages
      const attachedFiles = messageFilesRef.current;
      messageFilesRef.current = [];

      // Add user message to state
      addMessage(userMessage);

      // Create the assistant message with loading state
      const assistantMessage: ChatMessage = {
        id: assistantMessageId,
        content: "",
        sender: "assistant",
        createdAt: new Date(now.getTime() + 1), // 1ms after user message
        authorId: "assistant",
        loading: { state: "loading" },
      };

      // Add assistant message to state
      addMessage(assistantMessage);

      try {
        // Use the new messaging API (delegating to our new context)
        await contextSendMessage(content, {
          previousMessageId: lastMessageId,
          fileIds: attachedFiles.map((file) => file.id),
        });
      } catch (error) {
        console.error("Error sending message:", error);

        // Update the assistant message with the error
        updateMessage(assistantMessageId, {
          loading: undefined,
          error:
            error instanceof Error
              ? error
              : new Error("Failed to send message"),
        });
      }
    },
    [
      messageOrder,
      addMessage,
      updateMessage,
      contextSendMessage,
      messageFilesRef,
    ],
  );

  return {
    sendMessage,
    handleFileAttachments,
    performFileUpload,
    isUploadingFiles,
    uploadError,
    lastAssistantMessageId: lastAssistantMessageRef.current,
  };
}
