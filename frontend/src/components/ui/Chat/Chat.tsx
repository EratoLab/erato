import { t } from "@lingui/core/macro";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useCallback, useEffect, useRef, useState } from "react";

import { FilePreviewModal } from "@/components/ui/Modal/FilePreviewModal";
import { useChatActions } from "@/hooks/chat";
import { useMessagingStore } from "@/hooks/chat/store/messagingStore";
import { useMessageFeedback } from "@/hooks/chat/useMessageFeedback";
import { useSidebar, useFilePreviewModal } from "@/hooks/ui";
import { useProfile } from "@/hooks/useProfile";
import { chatMessagesQuery } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { useChatContext } from "@/providers/ChatProvider";
import { extractTextFromContent } from "@/utils/adapters/contentPartAdapter";
import { createLogger } from "@/utils/debugLogger";

import { ChatHistorySidebar } from "./ChatHistorySidebar";
import { ChatInput } from "./ChatInput";
import { Alert } from "../Feedback/Alert";
import { ChatErrorBoundary } from "../Feedback/ChatErrorBoundary";
import { FeedbackCommentDialog } from "../Feedback/FeedbackCommentDialog";
import { FeedbackViewDialog } from "../Feedback/FeedbackViewDialog";
import { MessageList } from "../MessageList/MessageList";

import type { ChatMessage } from "../MessageList/MessageList";
import type {
  FileUploadItem,
  ChatModel,
  ContentPart,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ChatSession } from "@/types/chat";
import type {
  MessageAction,
  MessageControlsComponent,
  MessageControlsContext,
} from "@/types/message-controls";
import type { FileType } from "@/utils/fileTypes";
import type React from "react";

// Create logger for this component
const logger = createLogger("UI", "Chat");

export interface ChatProps {
  /**
   * Messages to display
   */
  messages: Record<string, ChatMessage>;
  /**
   * Order of message IDs
   */
  messageOrder: string[];
  className?: string;
  /**
   * Layout configuration
   */
  layout?: "default" | "compact" | "comfortable";
  /**
   * Maximum width of messages
   */
  maxWidth?: number;
  /**
   * Whether to show avatars
   */
  showAvatars?: boolean;
  /**
   * Whether to show timestamps
   */
  showTimestamps?: boolean;
  // New unified handler
  onMessageAction?: (action: MessageAction) => Promise<boolean>;
  // Context for controls
  controlsContext: MessageControlsContext;
  // Optional custom controls component
  messageControls?: MessageControlsComponent;
  onNewChat?: () => void;
  onRegenerate?: () => void;
  // Sidebar collapsed state is now handled by context, so these are optional
  sidebarCollapsed?: boolean;
  onToggleCollapse?: () => void;
  /** Optional array of accepted file types */
  acceptedFileTypes?: FileType[];
  /** Optional custom session select handler to override default behavior */
  customSessionSelect?: (sessionId: string) => void;
  /** Optional custom component to show when there are no messages */
  emptyStateComponent?: React.ReactNode;
  /** Optional assistant ID for context-aware sending */
  assistantId?: string;
  /** Optional initial model to use (overrides chat history model) */
  initialModelOverride?: ChatModel | null;
}

/**
 * Main Chat component that integrates chat UI, history, and messaging functionality.
 * This is the top-level component that coordinates all chat-related components.
 */
export const Chat = ({
  messages,
  messageOrder,
  className,
  layout = "default",
  maxWidth = 768,
  showAvatars = false,
  showTimestamps = true,
  onMessageAction,
  controlsContext,
  messageControls,
  onNewChat,
  onRegenerate,
  // Prefix unused props with underscore
  sidebarCollapsed: _sidebarCollapsed,
  onToggleCollapse: _onToggleCollapse,
  acceptedFileTypes,
  customSessionSelect,
  emptyStateComponent,
  assistantId,
  initialModelOverride,
}: ChatProps) => {
  // Use the sidebar context
  const { isOpen: sidebarCollapsed, toggle: onToggleCollapse } = useSidebar();

  // Get chat data and actions from context provider
  const {
    sendMessage,
    editMessage,
    regenerateMessage,
    isMessagingLoading: chatLoading,
    chats: chatHistory,
    currentChatId,
    navigateToChat: switchSession,
    archiveChat,
    createNewChat: createChat,
    isHistoryLoading: chatHistoryLoading,
    historyError: chatHistoryError,
    refetchHistory: refreshChats,
    currentChatLastModel,
    messagingError,
  } = useChatContext();

  const { profile } = useProfile();

  // Convert the chat history data to the format expected by the sidebar
  const sessions: ChatSession[] = Array.isArray(chatHistory)
    ? chatHistory.map((chat) => ({
        id: chat.id,
        title:
          chat.title_by_summary ||
          t({ id: "chat.newChat.title", message: "New Chat" }), // Use title from API
        updatedAt: chat.last_message_at || new Date().toISOString(), // Use last message timestamp
        messages: [], // We don't need to populate messages here
        metadata: {
          lastMessage: {
            content: chat.title_by_summary || "", // Reuse title as a preview if no actual message available
            timestamp: chat.last_message_at || new Date().toISOString(),
          },
          fileCount: chat.file_uploads.length,
        },
      }))
    : [];

  const canEditForCurrentChat = Array.isArray(chatHistory)
    ? !!chatHistory.find((c) => c.id === (currentChatId ?? ""))?.can_edit
    : false;

  // Use chat actions hook for handlers
  const { handleSendMessage: baseHandleSendMessage, handleMessageAction } =
    useChatActions({
      switchSession,
      sendMessage,
      onMessageAction,
    });

  // Enhanced sendMessage handler that refreshes the sidebar after sending
  const handleSendMessage = useCallback(
    (message: string, inputFileIds?: string[], modelId?: string) => {
      logger.log("[CHAT_FLOW] Chat - handleSendMessage called", {
        files: inputFileIds,
        model: modelId,
        assistantId,
      });

      baseHandleSendMessage(message, inputFileIds, modelId, assistantId)
        .then(() => {
          logger.log("[CHAT_FLOW] Message sent, refreshing chats");
          return refreshChats();
        })
        .catch((error) => {
          logger.log("[CHAT_FLOW] Error sending message:", error);
        });
    },
    [baseHandleSendMessage, refreshChats, assistantId],
  );

  // Local edit state (simple UX; further polish can come later)
  const [editState, setEditState] = useState<
    | { mode: "edit"; messageId: string; initialContent: ContentPart[] }
    | { mode: "compose" }
  >({ mode: "compose" });

  // Debug logging for edit state changes
  useEffect(() => {
    logger.log("Edit state changed:", editState);
  }, [editState]);

  const cancelEdit = useCallback(() => setEditState({ mode: "compose" }), []);

  const handleEditSubmit = useCallback(
    (messageId: string, newContent: string, replaceInputFileIds?: string[]) => {
      void editMessage(messageId, newContent, replaceInputFileIds).finally(
        () => {
          setEditState({ mode: "compose" });
        },
      );
    },
    [editMessage],
  );

  const handleRegenerate = useCallback(
    (assistantMessageId: string) => {
      void regenerateMessage(assistantMessageId);
    },
    [regenerateMessage],
  );

  // Handler for when the error boundary resets
  const handleErrorReset = useCallback(() => {
    // Refresh chats on error reset
    void refreshChats();
  }, [refreshChats]);

  // Handle session select with void return type
  const handleSessionSelectWrapper = (sessionId: string) => {
    logger.log(
      `[CHAT_FLOW] Handling session select in Chat component for session: ${sessionId}`,
    );
    // Call handleSessionSelect or directly use switchSession if that's not working
    if (customSessionSelect) {
      customSessionSelect(sessionId);
    } else {
      logger.log(
        `[CHAT_FLOW] Directly calling switchSession with ID: ${sessionId}`,
      );
      switchSession(sessionId);
    }
  };

  // Handle archiving a session
  const handleArchiveSession = (sessionId: string) => {
    // Use void to explicitly ignore the promise returned by archiveChat
    void archiveChat(sessionId);
  };

  // Function to capture the scrollToBottom from MessageList
  const scrollToBottomRef = useRef<(() => void) | null>(null);
  const handleMessageListRef = useCallback((scrollToBottom: () => void) => {
    scrollToBottomRef.current = scrollToBottom;
  }, []);

  // Handle creating a new chat
  const handleNewChat = useCallback(async () => {
    logger.log("[CHAT_FLOW] New chat button clicked");

    try {
      if (onNewChat) {
        // Use custom handler if provided
        onNewChat();
      } else {
        // Otherwise use the default behavior from context
        // Don't chain with then() - use await for cleaner flow
        await createChat();
        logger.log("[CHAT_FLOW] New chat creation completed");
      }
    } catch (error) {
      logger.log("[CHAT_FLOW] Error creating new chat:", error);
    }
  }, [onNewChat, createChat]);

  // Use the file preview modal hook
  const {
    isPreviewModalOpen,
    fileToPreview,
    openPreviewModal,
    closePreviewModal,
  } = useFilePreviewModal();

  // Query client for cache invalidation after feedback submission
  const queryClient = useQueryClient();

  // Callback to invalidate chat messages cache after feedback submission
  const handleFeedbackSuccess = useCallback(() => {
    if (currentChatId) {
      void queryClient.invalidateQueries({
        queryKey: chatMessagesQuery({
          pathParams: { chatId: currentChatId },
        }).queryKey,
      });
    }
  }, [queryClient, currentChatId]);

  // Use the message feedback hook for all feedback-related logic
  const {
    feedbackDialogState,
    feedbackViewDialogState,
    feedbackConfig,
    handleFeedbackSubmit,
    closeFeedbackDialog,
    closeFeedbackViewDialog,
    handleFeedbackDialogSubmit,
    openFeedbackDialog,
    openFeedbackViewDialog,
    switchToEditMode,
    canEditFeedback,
  } = useMessageFeedback({
    onFeedbackSuccess: handleFeedbackSuccess,
  });

  // Restore placeholder definitions for props passed to MessageList
  const hasOlderMessages = false;
  const loadOlderMessages = () => {
    // Pagination not yet implemented
  };

  // Restore a basic handleFileAttachments function needed by ChatInput
  const handleFileAttachments = useCallback((files: FileUploadItem[]) => {
    logger.log(
      `handleFileAttachments in Chat.tsx called with: ${files.length} files. (Currently only enables button rendering)`,
    );
    // This function might be needed later if we want Chat.tsx
    // to be aware of files attached in ChatInput before sending.
    // For now, its presence enables the button in ChatInput.
  }, []);

  if (process.env.NODE_ENV === "development") {
    logger.log(
      `Chat.tsx rendering. chatLoading: ${chatLoading}, currentChatId: ${currentChatId ?? ""}, sidebarCollapsed: ${sidebarCollapsed}, messagesCount: ${Object.keys(messages).length}`,
    );
  }

  return (
    <div className="flex size-full flex-col sm:flex-row">
      <ChatHistorySidebar
        collapsed={sidebarCollapsed}
        onNewChat={() => {
          void handleNewChat();
        }}
        onToggleCollapse={onToggleCollapse}
        sessions={sessions}
        currentSessionId={currentChatId ?? ""}
        onSessionSelect={handleSessionSelectWrapper}
        onSessionArchive={handleArchiveSession}
        showTimestamps={showTimestamps}
        isLoading={chatHistoryLoading}
        error={chatHistoryError instanceof Error ? chatHistoryError : undefined}
        className="fixed inset-0 z-50 sm:relative sm:z-auto"
        userProfile={profile}
      />
      <ChatErrorBoundary onReset={handleErrorReset}>
        <div
          className={clsx(
            "flex h-full min-w-0 flex-1 flex-col bg-theme-bg-secondary",
            "sm:mt-0",
            className,
          )}
          role="region"
          aria-label={t({
            id: "chat.conversation.aria",
            message: "Chat conversation",
          })}
        >
          {/* Use the MessageList component */}
          <MessageList
            messages={messages}
            messageOrder={messageOrder}
            loadOlderMessages={loadOlderMessages}
            hasOlderMessages={hasOlderMessages}
            isPending={chatLoading}
            currentSessionId={currentChatId ?? ""}
            pageSize={6}
            maxWidth={maxWidth}
            showTimestamps={showTimestamps}
            showAvatars={showAvatars}
            userProfile={profile}
            controls={messageControls}
            controlsContext={{
              ...controlsContext,
              canEdit: canEditForCurrentChat,
            }}
            onMessageAction={async (action: MessageAction) => {
              // Intercept edit/regenerate here to route to local handlers
              if (action.type === "edit") {
                logger.log(
                  `Edit action called with messageId: ${action.messageId}`,
                );

                // Find the message directly from the messages object
                const messageToEdit = messages[action.messageId];
                logger.log(`Available message keys:`, Object.keys(messages));
                logger.log(`Looking up message:`, messageToEdit);

                if (messageToEdit.role === "user") {
                  logger.log(
                    `Setting editState: messageId=${action.messageId}, content="${extractTextFromContent(messageToEdit.content)}"`,
                  );

                  // Use React's functional update to ensure we get the latest state
                  setEditState(() => ({
                    mode: "edit",
                    messageId: action.messageId,
                    initialContent: messageToEdit.content,
                  }));

                  logger.log(`editState set successfully`);
                } else {
                  logger.log(
                    `Cannot edit message ${action.messageId}: not found or not a user message`,
                    {
                      messageToEdit,
                      role: messageToEdit.role,
                      available: Object.keys(messages),
                    },
                  );
                }
                return true;
              }
              if (action.type === "regenerate") {
                handleRegenerate(action.messageId);
                return true;
              }
              // Handle like/dislike feedback actions
              if (action.type === "like" || action.type === "dislike") {
                const sentiment =
                  action.type === "like" ? "positive" : "negative";

                // Submit feedback immediately (cache invalidation handled by onFeedbackSuccess callback)
                const result = await handleFeedbackSubmit(
                  action.messageId,
                  sentiment,
                );

                // If comments are enabled, open the dialog for additional comment
                if (result.success && feedbackConfig.commentsEnabled) {
                  openFeedbackDialog(action.messageId, sentiment);
                }

                return result.success;
              }
              return handleMessageAction(action);
            }}
            className={layout}
            useVirtualization={messageOrder.length > 30}
            virtualizationThreshold={30}
            onScrollToBottomRef={handleMessageListRef}
            onFilePreview={openPreviewModal}
            onViewFeedback={openFeedbackViewDialog}
            emptyStateComponent={emptyStateComponent}
          />

          {/* Generation error display */}
          {messagingError && (
            <Alert
              type="error"
              dismissible
              onDismiss={() => {
                useMessagingStore.getState().setError(null);
              }}
              className="mx-2 mb-2 sm:mx-4 sm:mb-4"
              data-testid="generation-error-alert"
            >
              {messagingError instanceof Error
                ? messagingError.message
                : String(messagingError)}
            </Alert>
          )}

          <ChatInput
            onSendMessage={handleSendMessage}
            onEditMessage={handleEditSubmit}
            onCancelEdit={editState.mode === "edit" ? cancelEdit : undefined}
            acceptedFileTypes={acceptedFileTypes}
            onFilePreview={openPreviewModal}
            handleFileAttachments={handleFileAttachments}
            chatId={currentChatId}
            className="p-2 sm:p-4"
            isLoading={chatLoading}
            showControls
            onRegenerate={onRegenerate}
            showFileTypes={true}
            initialFiles={[]}
            mode={editState.mode}
            editMessageId={
              editState.mode === "edit" ? editState.messageId : undefined
            }
            editInitialContent={
              editState.mode === "edit" ? editState.initialContent : undefined
            }
            initialModel={initialModelOverride ?? currentChatLastModel}
          />
        </div>
      </ChatErrorBoundary>

      {/* Render the File Preview Modal */}
      <FilePreviewModal
        isOpen={isPreviewModalOpen}
        onClose={closePreviewModal}
        file={fileToPreview}
      />

      {/* Render the Feedback View Dialog */}
      <FeedbackViewDialog
        isOpen={feedbackViewDialogState.isOpen}
        onClose={closeFeedbackViewDialog}
        onEdit={switchToEditMode}
        feedback={feedbackViewDialogState.feedback}
        canEdit={
          feedbackViewDialogState.feedback
            ? canEditFeedback(feedbackViewDialogState.feedback)
            : false
        }
      />

      {/* Render the Feedback Comment Dialog */}
      <FeedbackCommentDialog
        isOpen={feedbackDialogState.isOpen}
        onClose={closeFeedbackDialog}
        onSubmit={handleFeedbackDialogSubmit}
        sentiment={feedbackDialogState.sentiment}
        mode={feedbackDialogState.mode}
        initialComment={feedbackDialogState.initialComment}
        error={feedbackDialogState.error}
      />
    </div>
  );
};
