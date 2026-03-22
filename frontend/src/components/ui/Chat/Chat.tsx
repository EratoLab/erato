import { t } from "@lingui/core/macro";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";

import { FilePreviewModal } from "@/components/ui/Modal/FilePreviewModal";
import {
  componentRegistry,
  resolveComponentOverride,
} from "@/config/componentRegistry";
import { useChatActions } from "@/hooks/chat";
import { useMessageFeedback } from "@/hooks/chat/useMessageFeedback";
import { useFileUploadWithTokenCheck } from "@/hooks/files/useFileUploadWithTokenCheck";
import { useSidebar, useFilePreviewModal } from "@/hooks/ui";
import { useProfile } from "@/hooks/useProfile";
import { chatMessagesQuery } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { useChatContext } from "@/providers/ChatProvider";
import { useSidebarFeature } from "@/providers/FeatureConfigProvider";
import { extractTextFromContent } from "@/utils/adapters/contentPartAdapter";
import { createLogger } from "@/utils/debugLogger";
import { FileTypeUtil } from "@/utils/fileTypes";

import { ChatHistorySidebar } from "./ChatHistorySidebar";
import { ChatInput } from "./ChatInput";
import {
  ChatInputControlsProvider,
  type ChatInputControlsHandle,
} from "./ChatInputControlsContext";
import { ChatMessage as ChatMessageComponent } from "./ChatMessage";
import { EditChatTitleDialog } from "./EditChatTitleDialog";
import { ChatErrorBoundary } from "../Feedback/ChatErrorBoundary";
import { FeedbackCommentDialog } from "../Feedback/FeedbackCommentDialog";
import { FeedbackViewDialog } from "../Feedback/FeedbackViewDialog";
import { DefaultMessageControls } from "../Message/DefaultMessageControls";
import { MessageList } from "../MessageList/MessageList";
import { DocumentIcon } from "../icons";

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
  /** Optional assistant default files to include for erato-file link resolution */
  assistantFiles?: FileUploadItem[];
  /** Optional default facets configured for the assistant backing this chat */
  assistantConfiguredFacetIds?: string[];
  /** Whether the assistant facet selection is enforced for derived chats */
  assistantFacetSettingsEnforced?: boolean;
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
  maxWidth,
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
  assistantFiles = [],
  assistantConfiguredFacetIds,
  assistantFacetSettingsEnforced = false,
}: ChatProps) => {
  // Use the sidebar context
  const {
    isOpen: sidebarCollapsed,
    toggle: onToggleCollapse,
    collapsedMode,
  } = useSidebar();

  const chatInputControlsRef = useRef<ChatInputControlsHandle | null>(null);
  const chatInputControls = useMemo(
    () => ({
      setDraftMessage: (message: string, options?: { focus?: boolean }) => {
        chatInputControlsRef.current?.setDraftMessage(message, options);
      },
      focusInput: () => {
        chatInputControlsRef.current?.focusInput();
      },
      setSelectedFacetIds: (facetIds: string[]) => {
        chatInputControlsRef.current?.setSelectedFacetIds(facetIds);
      },
      setSelectedChatProviderId: (chatProviderId: string) => {
        chatInputControlsRef.current?.setSelectedChatProviderId(chatProviderId);
      },
      toggleFacetId: (facetId: string) => {
        chatInputControlsRef.current?.toggleFacetId(facetId);
      },
      addUploadedFiles: (files: FileUploadItem[]) => {
        chatInputControlsRef.current?.addUploadedFiles(files);
      },
    }),
    [],
  );

  const [selectedChatProviderId, setSelectedChatProviderId] = useState<
    string | null
  >(initialModelOverride?.chat_provider_id ?? null);

  // Resolve message controls from registry if not explicitly provided
  const resolvedMessageControls = useMemo(
    () =>
      (messageControls ??
        resolveComponentOverride(
          componentRegistry.MessageControls,
          DefaultMessageControls,
        )) as MessageControlsComponent,
    [messageControls],
  );

  // Resolve message renderer from registry
  const resolvedMessageRenderer = useMemo(
    () =>
      resolveComponentOverride(
        componentRegistry.ChatMessageRenderer,
        ChatMessageComponent,
      ),
    [],
  );

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
    updateChatTitle,
    createNewChat: createChat,
    isHistoryLoading: chatHistoryLoading,
    historyError: chatHistoryError,
    refetchHistory: refreshChats,
    currentChatLastModel,
  } = useChatContext();

  useEffect(() => {
    if (selectedChatProviderId) {
      return;
    }

    const fallbackChatProviderId =
      initialModelOverride?.chat_provider_id ??
      currentChatLastModel?.chat_provider_id ??
      null;

    if (fallbackChatProviderId) {
      setSelectedChatProviderId(fallbackChatProviderId);
    }
  }, [
    currentChatLastModel?.chat_provider_id,
    initialModelOverride?.chat_provider_id,
    selectedChatProviderId,
  ]);

  const { uploadFiles, uploadError, isUploading } = useFileUploadWithTokenCheck(
    {
      message: "",
      chatId: currentChatId,
      assistantId,
      chatProviderId: selectedChatProviderId ?? undefined,
      acceptedFileTypes,
      multiple: true,
    },
  );

  const { profile } = useProfile();

  // Get sidebar feature configuration
  const { chatHistoryShowMetadata } = useSidebarFeature();

  // Convert the chat history data to the format expected by the sidebar
  const sessions: ChatSession[] = useMemo(
    () =>
      Array.isArray(chatHistory)
        ? chatHistory.map((chat) => ({
            id: chat.id,
            title:
              chat.title_resolved ||
              t({ id: "chat.newChat.title", message: "New Chat" }),
            titleResolved: chat.title_resolved,
            titleBySummary:
              (chat.title_by_summary as string | null | undefined) ?? null,
            titleByUserProvided:
              (chat.title_by_user_provided as string | null | undefined) ??
              null,
            canEdit: chat.can_edit,
            updatedAt: chat.last_message_at || new Date().toISOString(),
            messages: [],
            metadata: {
              lastMessage: {
                content: chat.title_resolved || "",
                timestamp: chat.last_message_at || new Date().toISOString(),
              },
              fileCount: chat.file_uploads.length,
            },
          }))
        : [],
    [chatHistory],
  );

  const canEditForCurrentChat = Array.isArray(chatHistory)
    ? !!chatHistory.find((c) => c.id === (currentChatId ?? ""))?.can_edit
    : false;

  const currentChatLastSelectedFacets = useMemo(() => {
    if (!Array.isArray(chatHistory)) {
      return undefined;
    }

    return chatHistory.find((chat) => chat.id === (currentChatId ?? ""))
      ?.last_selected_facets;
  }, [chatHistory, currentChatId]);

  const effectiveInitialSelectedFacetIds = useMemo(() => {
    if (assistantFacetSettingsEnforced) {
      return assistantConfiguredFacetIds ?? [];
    }

    if (currentChatLastSelectedFacets !== undefined) {
      return currentChatLastSelectedFacets;
    }

    return assistantConfiguredFacetIds;
  }, [
    assistantConfiguredFacetIds,
    assistantFacetSettingsEnforced,
    currentChatLastSelectedFacets,
  ]);

  const [activeSelectedFacetIds, setActiveSelectedFacetIds] = useState<
    string[]
  >(effectiveInitialSelectedFacetIds ?? []);

  useEffect(() => {
    setActiveSelectedFacetIds(effectiveInitialSelectedFacetIds ?? []);
  }, [currentChatId, effectiveInitialSelectedFacetIds]);

  // Use chat actions hook for handlers
  const { handleSendMessage: baseHandleSendMessage, handleMessageAction } =
    useChatActions({
      switchSession,
      sendMessage,
      onMessageAction,
    });

  // Enhanced sendMessage handler that refreshes the sidebar after sending
  const handleSendMessage = useCallback(
    (
      message: string,
      inputFileIds?: string[],
      modelId?: string,
      selectedFacetIds?: string[],
    ) => {
      logger.log("[CHAT_FLOW] Chat - handleSendMessage called", {
        files: inputFileIds,
        model: modelId,
        assistantId,
        selectedFacetIds,
      });

      baseHandleSendMessage(
        message,
        inputFileIds,
        modelId,
        assistantId,
        selectedFacetIds,
      )
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
    | {
        mode: "edit";
        messageId: string;
        initialContent: ContentPart[];
        initialFiles: FileUploadItem[];
      }
    | { mode: "compose" }
  >({ mode: "compose" });

  // Debug logging for edit state changes
  useEffect(() => {
    logger.log("Edit state changed:", editState);
  }, [editState]);

  const cancelEdit = useCallback(() => setEditState({ mode: "compose" }), []);

  const handleEditSubmit = useCallback(
    (
      messageId: string,
      newContent: string,
      replaceInputFileIds?: string[],
      selectedFacetIds?: string[],
    ) => {
      void editMessage(
        messageId,
        newContent,
        replaceInputFileIds,
        selectedFacetIds,
      ).finally(() => {
        setEditState({ mode: "compose" });
      });
    },
    [editMessage],
  );

  const handleRegenerate = useCallback(
    (assistantMessageId: string) => {
      void regenerateMessage(assistantMessageId, activeSelectedFacetIds);
    },
    [activeSelectedFacetIds, regenerateMessage],
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

  const [titleDialogChatId, setTitleDialogChatId] = useState<string | null>(
    null,
  );
  const [isUpdatingChatTitle, setIsUpdatingChatTitle] = useState(false);

  const handleEditTitleSession = useCallback((sessionId: string) => {
    setTitleDialogChatId(sessionId);
  }, []);

  const handleCloseEditTitleDialog = useCallback(() => {
    if (isUpdatingChatTitle) return;
    setTitleDialogChatId(null);
  }, [isUpdatingChatTitle]);

  const activeTitleDialogSession = useMemo(
    () => sessions.find((session) => session.id === titleDialogChatId) ?? null,
    [sessions, titleDialogChatId],
  );

  const handleSubmitEditTitleDialog = useCallback(
    async (title: string) => {
      if (!titleDialogChatId) {
        return;
      }

      try {
        setIsUpdatingChatTitle(true);
        await updateChatTitle(titleDialogChatId, title);
        await refreshChats();
        setTitleDialogChatId(null);
      } finally {
        setIsUpdatingChatTitle(false);
      }
    },
    [titleDialogChatId, updateChatTitle, refreshChats],
  );

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

  const handleConversationDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length === 0) {
        return;
      }

      void uploadFiles(acceptedFiles).then((uploadedFiles) => {
        if (uploadedFiles && uploadedFiles.length > 0) {
          chatInputControlsRef.current?.addUploadedFiles(uploadedFiles);
        }
      });
    },
    [uploadFiles],
  );

  const {
    getRootProps: getConversationDropzoneRootProps,
    getInputProps: getConversationDropzoneInputProps,
    isDragActive,
    isDragAccept,
  } = useDropzone({
    onDrop: handleConversationDrop,
    accept:
      acceptedFileTypes && acceptedFileTypes.length > 0
        ? FileTypeUtil.getAcceptObject(acceptedFileTypes)
        : undefined,
    multiple: true,
    disabled: isUploading,
    noClick: true,
    noKeyboard: true,
  });

  if (process.env.NODE_ENV === "development") {
    logger.log(
      `Chat.tsx rendering. chatLoading: ${chatLoading}, currentChatId: ${currentChatId ?? ""}, sidebarCollapsed: ${sidebarCollapsed}, messagesCount: ${Object.keys(messages).length}`,
    );
  }

  const appShellStyle = useMemo(
    () => ({
      backgroundColor: "var(--theme-shell-app)",
    }),
    [],
  );

  const pageShellStyle = useMemo(
    () => ({
      backgroundColor: "var(--theme-shell-page)",
    }),
    [],
  );

  return (
    <ChatInputControlsProvider value={chatInputControls}>
      <div
        className="flex size-full flex-col sm:flex-row"
        data-ui="app-shell"
        style={appShellStyle}
      >
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
          onSessionEditTitle={handleEditTitleSession}
          showTimestamps={chatHistoryShowMetadata}
          isLoading={chatHistoryLoading}
          error={
            chatHistoryError instanceof Error ? chatHistoryError : undefined
          }
          userProfile={profile}
        />
        <ChatErrorBoundary onReset={handleErrorReset}>
          <div
            {...getConversationDropzoneRootProps()}
            className={clsx(
              "relative flex h-full min-w-0 flex-1 flex-col",
              "sm:mt-0",
              // Add left margin based on sidebar state to prevent overlap with fixed sidebar
              // Transition margin to match sidebar animation (300ms)
              "transition-[margin] duration-300 ease-in-out motion-reduce:transition-none",
              // When expanded: full width (320px)
              !sidebarCollapsed && "sm:ml-[var(--theme-layout-sidebar-width)]",
              // When collapsed in slim mode: narrow width (64px)
              sidebarCollapsed && collapsedMode === "slim" && "sm:ml-16",
              // When collapsed in hidden mode: no margin (sidebar is off-screen)
              // (default, no class needed)
              className,
            )}
            role="region"
            aria-label={t({
              id: "chat.conversation.aria",
              message: "Chat conversation",
            })}
            data-ui="chat-conversation-dropzone"
            style={pageShellStyle}
          >
            <input
              {...getConversationDropzoneInputProps()}
              aria-label={t({
                id: "chat.conversation.dropzone.ariaLabel",
                message: "Drop files anywhere in the conversation to upload",
              })}
            />
            {isDragActive && isDragAccept && (
              <div
                className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center overflow-hidden bg-[color:color-mix(in_srgb,var(--theme-shell-chat-body)_75%,transparent)]"
                data-testid="chat-drop-overlay"
              >
                <div className="relative flex flex-col items-center gap-3 px-8 py-7 text-center">
                  <DocumentIcon className="size-12 text-[var(--theme-fg-primary)] drop-shadow-[0_8px_24px_rgba(0,0,0,0.18)]" />
                  <p className="text-sm font-medium text-[var(--theme-fg-primary)] [text-shadow:0_1px_12px_rgba(255,255,255,0.18)]">
                    {t({
                      id: "chat.fileDrop.overlay.label",
                      message: "Drop to upload",
                    })}
                  </p>
                </div>
              </div>
            )}
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
              controls={resolvedMessageControls}
              messageRenderer={resolvedMessageRenderer}
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
                    const messageFiles = (
                      messageToEdit as ChatMessage & {
                        files?: FileUploadItem[];
                      }
                    ).files;
                    const initialFiles = Array.isArray(messageFiles)
                      ? messageFiles
                      : [];
                    logger.log(
                      `Setting editState: messageId=${action.messageId}, content="${extractTextFromContent(messageToEdit.content)}"`,
                    );

                    // Use React's functional update to ensure we get the latest state
                    setEditState(() => ({
                      mode: "edit",
                      messageId: action.messageId,
                      initialContent: messageToEdit.content,
                      initialFiles,
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
              assistantFiles={assistantFiles}
            />

            <ChatInput
              ref={chatInputControlsRef}
              onSendMessage={handleSendMessage}
              onEditMessage={handleEditSubmit}
              onCancelEdit={editState.mode === "edit" ? cancelEdit : undefined}
              acceptedFileTypes={acceptedFileTypes}
              onFilePreview={openPreviewModal}
              handleFileAttachments={handleFileAttachments}
              chatId={currentChatId}
              assistantId={assistantId}
              className="p-2 sm:p-4"
              isLoading={chatLoading}
              showControls
              onRegenerate={onRegenerate}
              showFileTypes={true}
              initialFiles={
                editState.mode === "edit" ? editState.initialFiles : []
              }
              mode={editState.mode}
              editMessageId={
                editState.mode === "edit" ? editState.messageId : undefined
              }
              editInitialContent={
                editState.mode === "edit" ? editState.initialContent : undefined
              }
              initialModel={initialModelOverride ?? currentChatLastModel}
              initialSelectedFacetIds={effectiveInitialSelectedFacetIds}
              enforceSelectedFacetIds={assistantFacetSettingsEnforced}
              onFacetSelectionChange={setActiveSelectedFacetIds}
              onSelectedChatProviderIdChange={setSelectedChatProviderId}
              uploadFiles={uploadFiles}
              uploadError={uploadError}
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

        <EditChatTitleDialog
          isOpen={!!activeTitleDialogSession}
          generatedTitle={
            activeTitleDialogSession?.titleBySummary ??
            t({
              id: "chat.history.rename.generated.fallback",
              message: "Untitled Chat",
            })
          }
          initialUserProvidedTitle={
            activeTitleDialogSession?.titleByUserProvided ?? null
          }
          isSubmitting={isUpdatingChatTitle}
          onClose={handleCloseEditTitleDialog}
          onSubmit={handleSubmitEditTitleDialog}
        />
      </div>
    </ChatInputControlsProvider>
  );
};
