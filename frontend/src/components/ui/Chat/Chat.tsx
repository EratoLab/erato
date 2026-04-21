import { t } from "@lingui/core/macro";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { FilePreviewModal } from "@/components/ui/Modal/FilePreviewModal";
import {
  componentRegistry,
  resolveComponentOverride,
} from "@/config/componentRegistry";
import {
  useActiveModelSelection,
  useChatActions,
  useStandardMessageActions,
} from "@/hooks/chat";
import { useMessageFeedback } from "@/hooks/chat/useMessageFeedback";
import { useConversationDropzone } from "@/hooks/files/useConversationDropzone";
import { useFileUploadWithTokenCheck } from "@/hooks/files/useFileUploadWithTokenCheck";
import { useSidebar, useFilePreviewModal } from "@/hooks/ui";
import { useChatShareLink } from "@/hooks/useChatShareLink";
import { useProfile } from "@/hooks/useProfile";
import { chatMessagesQuery } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { useChatContext } from "@/providers/ChatProvider";
import {
  useChatInputFeature,
  useChatSharingFeature,
  useSidebarFeature,
} from "@/providers/FeatureConfigProvider";
import { createLogger } from "@/utils/debugLogger";

import { ChatHistorySidebar } from "./ChatHistorySidebar";
import { ChatInput } from "./ChatInput";
import {
  ChatInputControlsProvider,
  type ChatInputControlsHandle,
} from "./ChatInputControlsContext";
import { ChatMessage as ChatMessageComponent } from "./ChatMessage";
import { ChatShareDialog } from "./ChatShareDialog";
import { EditChatTitleDialog } from "./EditChatTitleDialog";
import { Button } from "../Controls/Button";
import { ChatErrorBoundary } from "../Feedback/ChatErrorBoundary";
import { FeedbackCommentDialog } from "../Feedback/FeedbackCommentDialog";
import { FeedbackViewDialog } from "../Feedback/FeedbackViewDialog";
import { DefaultMessageControls } from "../Message/DefaultMessageControls";
import { MessageList } from "../MessageList/MessageList";
import { DocumentIcon, ShareIcon } from "../icons";

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
  /** Force the centered empty-state layout regardless of feature config */
  forceCenteredEmptyState?: boolean;
  /** Optional content rendered at the top of the conversation area */
  topContent?: React.ReactNode;
  /** Optional override for the display name of user-authored messages */
  userMessageDisplayName?: string;
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
  /** Whether the chat should be rendered in read-only mode */
  readOnly?: boolean;
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
  forceCenteredEmptyState = false,
  topContent,
  userMessageDisplayName,
  assistantId,
  initialModelOverride,
  assistantFiles = [],
  assistantConfiguredFacetIds,
  assistantFacetSettingsEnforced = false,
  readOnly = false,
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
  const TopLeftAccessory = componentRegistry.ChatTopLeftAccessory;

  // Get chat data and actions from context provider
  const {
    sendMessage,
    editMessage,
    regenerateMessage,
    isMessagingLoading: chatLoading,
    isPendingResponse,
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

  const { availableModels, selectedModel, setSelectedModel, isSelectionReady } =
    useActiveModelSelection({
      initialModel: initialModelOverride ?? currentChatLastModel,
    });

  const { uploadFiles, uploadError, isUploading } = useFileUploadWithTokenCheck(
    {
      message: "",
      chatId: currentChatId,
      assistantId,
      chatProviderId: selectedModel?.chat_provider_id ?? undefined,
      acceptedFileTypes,
      multiple: true,
    },
  );

  const { profile } = useProfile();
  const { enabled: chatSharingEnabled } = useChatSharingFeature();

  // Get sidebar feature configuration
  const { chatHistoryShowMetadata } = useSidebarFeature();
  const { emptyStateLayout } = useChatInputFeature();

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
  const { shareLink: currentChatShareLink } = useChatShareLink(
    chatSharingEnabled && currentChatId && messageOrder.length > 0
      ? currentChatId
      : null,
  );

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
  const [shareDialogChatId, setShareDialogChatId] = useState<string | null>(
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
  const handleOpenShareDialog = useCallback((chatId: string) => {
    setShareDialogChatId(chatId);
  }, []);
  const handleCloseShareDialog = useCallback(() => {
    setShareDialogChatId(null);
  }, []);

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

  const standardMessageActionHandler = useStandardMessageActions({
    messages,
    setEditState,
    handleRegenerate,
    handleFeedbackSubmit,
    feedbackConfig,
    openFeedbackDialog,
    onUnhandledAction: handleMessageAction,
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

  const handleDropUploaded = useCallback((uploaded: FileUploadItem[]) => {
    chatInputControlsRef.current?.addUploadedFiles(uploaded);
  }, []);

  const {
    getRootProps: getConversationDropzoneRootProps,
    getInputProps: getConversationDropzoneInputProps,
    isDragActive,
    isDragAccept,
  } = useConversationDropzone({
    uploadFiles,
    onUploaded: handleDropUploaded,
    acceptedFileTypes,
    isUploading,
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

  const shouldRenderCenteredEmptyState =
    (forceCenteredEmptyState || emptyStateLayout === "centered") &&
    !!emptyStateComponent &&
    messageOrder.length === 0 &&
    !chatLoading &&
    !isPendingResponse &&
    editState.mode === "compose";

  const centeredEmptyStateContent =
    shouldRenderCenteredEmptyState &&
    isValidElement<{ className?: string }>(emptyStateComponent)
      ? cloneElement(emptyStateComponent, {
          className: clsx(
            emptyStateComponent.props.className,
            "!translate-y-0",
          ),
        })
      : emptyStateComponent;
  const canShareCurrentChat =
    chatSharingEnabled &&
    !!currentChatId &&
    messageOrder.length > 0 &&
    canEditForCurrentChat;
  const currentShareButtonLabel = currentChatShareLink?.enabled
    ? t({
        id: "chat.share.button.shared",
        message: "Shared",
      })
    : t({
        id: "chat.share.button",
        message: "Share",
      });

  const chatInputElement = (
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
      initialFiles={editState.mode === "edit" ? editState.initialFiles : []}
      mode={editState.mode}
      editMessageId={
        editState.mode === "edit" ? editState.messageId : undefined
      }
      editInitialContent={
        editState.mode === "edit" ? editState.initialContent : undefined
      }
      initialModel={initialModelOverride ?? currentChatLastModel}
      controlledAvailableModels={availableModels}
      controlledSelectedModel={selectedModel}
      onControlledSelectedModelChange={setSelectedModel}
      controlledIsModelSelectionReady={isSelectionReady}
      initialSelectedFacetIds={effectiveInitialSelectedFacetIds}
      enforceSelectedFacetIds={assistantFacetSettingsEnforced}
      onFacetSelectionChange={setActiveSelectedFacetIds}
      uploadFiles={uploadFiles}
      uploadError={uploadError}
    />
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
          onSessionShare={
            chatSharingEnabled ? handleOpenShareDialog : undefined
          }
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
              sidebarCollapsed &&
                collapsedMode === "slim" &&
                "sm:ml-[var(--theme-layout-sidebar-slim-width)]",
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
            {TopLeftAccessory ? (
              <TopLeftAccessory
                availableModels={availableModels}
                selectedModel={selectedModel}
                onModelChange={setSelectedModel}
                isModelSelectionReady={isSelectionReady}
              />
            ) : null}
            {shouldRenderCenteredEmptyState ? (
              <div
                className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-2 py-4 sm:px-4 sm:py-6"
                data-ui="chat-empty-state-centered-shell"
              >
                <div className="flex w-full flex-col items-center justify-center gap-4">
                  {centeredEmptyStateContent}
                  {!readOnly ? (
                    <div className="w-full shrink-0">{chatInputElement}</div>
                  ) : null}
                </div>
              </div>
            ) : (
              <>
                {topContent ? (
                  <div className="relative z-10 shrink-0 border-b border-theme-border bg-[var(--theme-shell-page)] p-3 sm:px-4">
                    {topContent}
                  </div>
                ) : null}
                {canShareCurrentChat ? (
                  <div className="absolute right-3 top-3 z-10 sm:right-4">
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<ShareIcon className="size-4" />}
                      onClick={() => {
                        handleOpenShareDialog(currentChatId);
                      }}
                    >
                      {currentShareButtonLabel}
                    </Button>
                  </div>
                ) : null}
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
                  userDisplayNameOverride={userMessageDisplayName}
                  controls={resolvedMessageControls}
                  messageRenderer={resolvedMessageRenderer}
                  controlsContext={{
                    ...controlsContext,
                    canEdit: canEditForCurrentChat,
                  }}
                  onMessageAction={standardMessageActionHandler}
                  className={clsx(
                    layout,
                    canShareCurrentChat && "pt-12 sm:pt-14",
                  )}
                  useVirtualization={messageOrder.length > 30}
                  virtualizationThreshold={30}
                  onScrollToBottomRef={handleMessageListRef}
                  onFilePreview={openPreviewModal}
                  onViewFeedback={openFeedbackViewDialog}
                  emptyStateComponent={emptyStateComponent}
                  assistantFiles={assistantFiles}
                />

                {!readOnly ? chatInputElement : null}
              </>
            )}
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

        <ChatShareDialog
          isOpen={shareDialogChatId !== null}
          chatId={shareDialogChatId}
          onClose={handleCloseShareDialog}
        />
      </div>
    </ChatInputControlsProvider>
  );
};
