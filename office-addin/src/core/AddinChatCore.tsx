import {
  ChatErrorBoundary,
  ChatInputControlsProvider,
  ChatMessage,
  DefaultMessageControls,
  DelegatedRunsSection,
  DocumentIcon,
  DropdownMenu,
  FeedbackCommentDialog,
  FeedbackViewDialog,
  FilePreviewModal,
  MessageEditProvider,
  MessageList,
  chatMessagesQuery,
  componentRegistry,
  extractTextFromContent,
  getSupportedFileTypes,
  resolveComponentOverride,
  transformEmailFencesForCopy,
  useActiveModelSelection,
  useChatContext,
  useConversationDropzone,
  useDelegatedRunHeader,
  useFileCapabilitiesContext,
  useFilePreviewModal,
  useFileUploadWithTokenCheck,
  useMessageFeedback,
  useProfile,
  useStandardMessageActions,
  type ActionFacetRequest,
  type AssistantMention,
  type ChatInputControlsHandle,
  type ChatMessageProps,
  type DelegatedRunsSectionProps,
  type DropdownMenuItem,
  type FileUploadItem,
  type MessageAction,
  type MessageControlsComponent,
  type MessageControlsContext,
} from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";

import { AddinChatInputCore } from "./AddinChatInputCore";
import { AddinSettingsDialogCore } from "./AddinSettingsDialogCore";

import type {
  ComponentProps,
  ComponentType,
  MutableRefObject,
  ReactNode,
} from "react";

export interface AddinChatHostCallbacks {
  beforeSend?: (hostContextIdentity?: string | null) => void;
  beforeEdit?: (messageId: string) => void;
  beforeRegenerate?: (assistantMessageId: string) => void;
}

export interface AddinChatInputRenderProps {
  ref: MutableRefObject<ChatInputControlsHandle | null>;
  onSendMessage: (
    message: string,
    inputFileIds?: string[],
    modelId?: string,
    selectedFacetIds?: string[],
    actionFacet?: ActionFacetRequest,
    hostContextIdentity?: string | null,
    mentionedAssistants?: AssistantMention[],
  ) => void;
  onFilePreview: (file: FileUploadItem) => void;
  handleFileAttachments: (files: FileUploadItem[]) => void;
  chatId: string | null;
  assistantId?: string;
  isLoading: boolean;
  disabled: boolean;
  controlledAvailableModels: AddinChatController["availableModels"];
  controlledSelectedModel: AddinChatController["selectedModel"];
  onControlledSelectedModelChange: AddinChatController["setSelectedModel"];
  controlledIsModelSelectionReady: boolean;
  initialSelectedFacetIds?: string[];
  onFacetSelectionChange: (facetIds: string[]) => void;
  uploadFiles: AddinChatController["uploadFiles"];
  uploadError: AddinChatController["uploadError"];
  maxFiles: number;
}

export interface AddinChatController {
  assistantId?: string;
  maxFiles: number;
  chatInputControlsRef: MutableRefObject<ChatInputControlsHandle | null>;
  chatInputControls: {
    setDraftMessage: (message: string, options?: { focus?: boolean }) => void;
    focusInput: () => void;
    setSelectedFacetIds: (facetIds: string[]) => void;
    toggleFacetId: (facetId: string) => void;
    setSelectedChatProviderId: (chatProviderId: string) => void;
    addUploadedFiles: (files: FileUploadItem[]) => void;
    clearQueuedMessage: () => void;
  };
  hostCallbacksRef: MutableRefObject<AddinChatHostCallbacks>;
  messages: ReturnType<typeof useChatContext>["messages"];
  messageOrder: string[];
  isMessagingLoading: boolean;
  isPendingResponse: boolean;
  chats: ReturnType<typeof useChatContext>["chats"];
  currentChatId: string | null;
  createNewChat: ReturnType<typeof useChatContext>["createNewChat"];
  refetchHistory: ReturnType<typeof useChatContext>["refetchHistory"];
  profile: ReturnType<typeof useProfile>["profile"];
  acceptedFileTypes: ReturnType<typeof getSupportedFileTypes>;
  availableModels: ReturnType<
    typeof useActiveModelSelection
  >["availableModels"];
  selectedModel: ReturnType<typeof useActiveModelSelection>["selectedModel"];
  setSelectedModel: ReturnType<
    typeof useActiveModelSelection
  >["setSelectedModel"];
  isSelectionReady: boolean;
  uploadFiles: ReturnType<typeof useFileUploadWithTokenCheck>["uploadFiles"];
  uploadError: ReturnType<typeof useFileUploadWithTokenCheck>["uploadError"];
  isUploading: boolean;
  currentChatLastSelectedFacets?: string[];
  setActiveSelectedFacetIds: (facetIds: string[]) => void;
  editingMessageId: string | null;
  setEditingMessageId: (messageId: string | null) => void;
  messageEditValue: ComponentProps<typeof MessageEditProvider>["value"];
  handleSendMessage: AddinChatInputRenderProps["onSendMessage"];
  isPreviewModalOpen: boolean;
  fileToPreview: ReturnType<typeof useFilePreviewModal>["fileToPreview"];
  relatedFiles: ReturnType<typeof useFilePreviewModal>["relatedFiles"];
  openPreviewModal: ReturnType<typeof useFilePreviewModal>["openPreviewModal"];
  closePreviewModal: ReturnType<
    typeof useFilePreviewModal
  >["closePreviewModal"];
  controlsContext: MessageControlsContext;
  resolvedMessageControls: MessageControlsComponent;
  resolvedMessageRenderer: ComponentType<ChatMessageProps>;
  standardMessageActionHandler: ReturnType<typeof useStandardMessageActions>;
  feedback: ReturnType<typeof useMessageFeedback>;
  isSettingsOpen: boolean;
  setIsSettingsOpen: (isOpen: boolean) => void;
  headerMenuItems: DropdownMenuItem[];
  /** Banner identifying the open chat as a delegated run; null otherwise. */
  delegatedRunHeader: ReactNode;
  /** A delegate still writing the run refuses sends with a 409; closing the
   * composer is how the user learns that instead of by sending into it. */
  composerLocked: boolean;
  openDelegatedRun: NonNullable<DelegatedRunsSectionProps["onOpenRun"]>;
}

export interface AddinChatHostProps {
  controller: AddinChatController;
}

export interface AddinChatCoreProps {
  assistantId?: string;
  maxFiles?: number;
  Host?: ComponentType<AddinChatHostProps>;
}

/**
 * Host-neutral chat controller. A host can provide a statically-defined Host
 * component, whose hooks execute in that component, while the generic chat
 * state and actions stay here.
 */
export function AddinChatCore({
  assistantId,
  maxFiles = 5,
  Host = NeutralAddinChatHost,
}: AddinChatCoreProps = {}) {
  const controller = useAddinChatController({ assistantId, maxFiles });
  return <Host controller={controller} />;
}

function useAddinChatController({
  assistantId,
  maxFiles,
}: {
  assistantId?: string;
  maxFiles: number;
}): AddinChatController {
  const chatInputControlsRef = useRef<ChatInputControlsHandle | null>(null);
  const hostCallbacksRef = useRef<AddinChatHostCallbacks>({});
  const chatInputControls = useMemo(
    () => ({
      setDraftMessage: (message: string, options?: { focus?: boolean }) =>
        chatInputControlsRef.current?.setDraftMessage(message, options),
      focusInput: () => chatInputControlsRef.current?.focusInput(),
      setSelectedFacetIds: (facetIds: string[]) =>
        chatInputControlsRef.current?.setSelectedFacetIds(facetIds),
      toggleFacetId: (facetId: string) =>
        chatInputControlsRef.current?.toggleFacetId(facetId),
      setSelectedChatProviderId: (chatProviderId: string) =>
        chatInputControlsRef.current?.setSelectedChatProviderId(chatProviderId),
      addUploadedFiles: (files: FileUploadItem[]) =>
        chatInputControlsRef.current?.addUploadedFiles(files),
      clearQueuedMessage: () =>
        chatInputControlsRef.current?.clearQueuedMessage(),
    }),
    [],
  );

  const chat = useChatContext();
  const { profile } = useProfile();
  const { capabilities } = useFileCapabilitiesContext();
  // In the pane a chat opens through the session controller, the same path
  // the recent-chats picker takes; the pane serves no chat routes to
  // navigate to.
  const openChatInPane = useCallback(
    (chatId: string) => chat.navigateToChat(chatId),
    [chat],
  );
  const runHeaderOptions = useMemo(
    () => ({ onOpenOrigin: openChatInPane }),
    [openChatInPane],
  );
  const { header: delegatedRunHeader, composerLocked } = useDelegatedRunHeader(
    chat.currentChatId,
    runHeaderOptions,
  );
  const openDelegatedRun = useCallback<
    NonNullable<DelegatedRunsSectionProps["onOpenRun"]>
  >((run) => openChatInPane(run.id), [openChatInPane]);
  const { availableModels, selectedModel, setSelectedModel, isSelectionReady } =
    useActiveModelSelection({ initialModel: chat.currentChatLastModel });
  const acceptedFileTypes = useMemo(
    () => getSupportedFileTypes(capabilities),
    [capabilities],
  );
  const { uploadFiles, uploadError, isUploading } = useFileUploadWithTokenCheck(
    {
      message: "",
      chatId: chat.currentChatId,
      assistantId,
      chatProviderId: selectedModel?.chat_provider_id ?? undefined,
      acceptedFileTypes,
      multiple: true,
      maxFiles,
    },
  );

  const canEditForCurrentChat = Array.isArray(chat.chats)
    ? !!chat.chats.find((item) => item.id === (chat.currentChatId ?? ""))
        ?.can_edit
    : false;
  const currentChatLastSelectedFacets = useMemo(() => {
    if (!Array.isArray(chat.chats)) return undefined;
    return chat.chats.find((item) => item.id === (chat.currentChatId ?? ""))
      ?.last_selected_facets;
  }, [chat.chats, chat.currentChatId]);
  const [activeSelectedFacetIds, setActiveSelectedFacetIds] = useState<
    string[]
  >(currentChatLastSelectedFacets ?? []);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);

  const handleSendMessage = useCallback<
    AddinChatInputRenderProps["onSendMessage"]
  >(
    (
      message,
      inputFileIds,
      modelId,
      selectedFacetIds,
      actionFacet,
      hostContextIdentity,
      mentionedAssistants,
    ) => {
      hostCallbacksRef.current.beforeSend?.(hostContextIdentity);
      void chat
        .sendMessage(
          message,
          inputFileIds,
          modelId,
          assistantId,
          selectedFacetIds,
          actionFacet,
          mentionedAssistants,
        )
        .then(() => chat.refetchHistory());
    },
    [assistantId, chat],
  );
  const cancelEdit = useCallback(() => setEditingMessageId(null), []);
  const handleEditSubmit = useCallback(
    (messageId: string, newContent: string, replaceInputFileIds: string[]) => {
      if (chat.isPendingResponse) return;
      chatInputControlsRef.current?.clearQueuedMessage();
      setEditingMessageId(null);
      hostCallbacksRef.current.beforeEdit?.(messageId);
      void chat.editMessage(
        messageId,
        newContent,
        replaceInputFileIds,
        activeSelectedFacetIds,
      );
    },
    [activeSelectedFacetIds, chat],
  );
  const messageEditValue = useMemo(
    () => ({
      editingMessageId,
      beginEdit: setEditingMessageId,
      cancelEdit,
      submitEdit: handleEditSubmit,
      isStreaming: chat.isPendingResponse,
      chatId: chat.currentChatId,
      assistantId,
      chatProviderId: selectedModel?.chat_provider_id,
    }),
    [
      assistantId,
      cancelEdit,
      chat.currentChatId,
      chat.isPendingResponse,
      editingMessageId,
      handleEditSubmit,
      selectedModel?.chat_provider_id,
    ],
  );
  const handleRegenerate = useCallback(
    (assistantMessageId: string) => {
      hostCallbacksRef.current.beforeRegenerate?.(assistantMessageId);
      void chat.regenerateMessage(assistantMessageId, activeSelectedFacetIds);
    },
    [activeSelectedFacetIds, chat],
  );

  const preview = useFilePreviewModal();
  const queryClient = useQueryClient();
  const handleFeedbackSuccess = useCallback(() => {
    if (!chat.currentChatId) return;
    void queryClient.invalidateQueries({
      queryKey: chatMessagesQuery({
        pathParams: { chatId: chat.currentChatId },
      }).queryKey,
    });
  }, [chat.currentChatId, queryClient]);
  const feedback = useMessageFeedback({
    onFeedbackSuccess: handleFeedbackSuccess,
  });

  const handleCopyAction = useCallback(
    async (action: MessageAction): Promise<boolean> => {
      if (action.type !== "copy") return false;
      const textContent = transformEmailFencesForCopy(
        extractTextFromContent(chat.messages[action.messageId]?.content),
      );
      if (!textContent) return false;
      try {
        if (!navigator.clipboard?.writeText)
          throw new Error("clipboard unavailable");
        await navigator.clipboard.writeText(textContent);
        return true;
      } catch {
        try {
          const textarea = document.createElement("textarea");
          textarea.value = textContent;
          textarea.style.position = "fixed";
          textarea.style.opacity = "0";
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand("copy");
          document.body.removeChild(textarea);
          return true;
        } catch (error) {
          console.warn("Failed to copy message content:", error);
          return false;
        }
      }
    },
    [chat.messages],
  );
  const standardMessageActionHandler = useStandardMessageActions({
    messages: chat.messages,
    onBeginEdit: setEditingMessageId,
    handleRegenerate,
    handleFeedbackSubmit: feedback.handleFeedbackSubmit,
    feedbackConfig: feedback.feedbackConfig,
    openFeedbackDialog: feedback.openFeedbackDialog,
    onUnhandledAction: handleCopyAction,
  });
  const controlsContext = useMemo<MessageControlsContext>(
    () => ({ currentUserId: profile?.id, canEdit: canEditForCurrentChat }),
    [canEditForCurrentChat, profile?.id],
  );
  const resolvedMessageControls = useMemo(
    () =>
      resolveComponentOverride(
        componentRegistry.MessageControls,
        DefaultMessageControls,
      ) as MessageControlsComponent,
    [],
  );
  const resolvedMessageRenderer = useMemo(
    () =>
      resolveComponentOverride(
        componentRegistry.ChatMessageRenderer,
        ChatMessage,
      ) as ComponentType<ChatMessageProps>,
    [],
  );
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const headerMenuItems = useMemo<DropdownMenuItem[]>(
    () => [
      {
        id: "settings",
        label: t({
          id: "officeAddin.headerMenu.settings",
          message: "Settings",
        }),
        onClick: () => setIsSettingsOpen(true),
      },
    ],
    [],
  );

  return {
    assistantId,
    maxFiles,
    chatInputControlsRef,
    chatInputControls,
    hostCallbacksRef,
    messages: chat.messages,
    messageOrder: chat.messageOrder,
    isMessagingLoading: chat.isMessagingLoading,
    isPendingResponse: chat.isPendingResponse,
    chats: chat.chats,
    currentChatId: chat.currentChatId,
    createNewChat: chat.createNewChat,
    refetchHistory: chat.refetchHistory,
    profile,
    acceptedFileTypes,
    availableModels,
    selectedModel,
    setSelectedModel,
    isSelectionReady,
    uploadFiles,
    uploadError,
    isUploading,
    currentChatLastSelectedFacets,
    setActiveSelectedFacetIds,
    editingMessageId,
    setEditingMessageId,
    messageEditValue,
    handleSendMessage,
    isPreviewModalOpen: preview.isPreviewModalOpen,
    fileToPreview: preview.fileToPreview,
    relatedFiles: preview.relatedFiles,
    openPreviewModal: preview.openPreviewModal,
    closePreviewModal: preview.closePreviewModal,
    controlsContext,
    resolvedMessageControls,
    resolvedMessageRenderer,
    standardMessageActionHandler,
    feedback,
    isSettingsOpen,
    setIsSettingsOpen,
    headerMenuItems,
    delegatedRunHeader,
    composerLocked,
    openDelegatedRun,
  };
}

type ConversationDropzone = ReturnType<typeof useConversationDropzone>;

function NeutralAddinChatHost({ controller }: AddinChatHostProps) {
  const dropzone = useConversationDropzone({
    uploadFiles: controller.uploadFiles,
    onUploaded: (files) => controller.chatInputControls.addUploadedFiles(files),
    acceptedFileTypes: controller.acceptedFileTypes,
    isUploading: controller.isUploading,
  });

  return (
    <AddinChatCoreView
      controller={controller}
      dropzone={dropzone}
      showDropOverlay={dropzone.isDragActive && dropzone.isDragAccept}
      renderInput={(props) => (
        <AddinChatInputCore
          {...props}
          onSendMessage={(
            message,
            inputFileIds,
            modelId,
            selectedFacetIds,
            mentionedAssistants,
          ) =>
            props.onSendMessage(
              message,
              inputFileIds,
              modelId,
              selectedFacetIds,
              undefined,
              undefined,
              mentionedAssistants,
            )
          }
        />
      )}
      renderSettings={(props) => <AddinSettingsDialogCore {...props} />}
    />
  );
}

export function AddinChatCoreView({
  controller,
  dropzone,
  showDropOverlay,
  messages = controller.messages,
  beforeMessages,
  renderInput,
  renderSettings,
}: {
  controller: AddinChatController;
  dropzone: Pick<
    ConversationDropzone,
    "getRootProps" | "getInputProps" | "isDragActive" | "isDragAccept"
  >;
  showDropOverlay: boolean;
  messages?: AddinChatController["messages"];
  beforeMessages?: ReactNode;
  renderInput: (props: AddinChatInputRenderProps) => ReactNode;
  renderSettings: (props: {
    isOpen: boolean;
    onClose: () => void;
  }) => ReactNode;
}) {
  const TopLeftAccessory = componentRegistry.ChatTopLeftAccessory;
  const feedback = controller.feedback;
  const inputProps: AddinChatInputRenderProps = {
    ref: controller.chatInputControlsRef,
    onSendMessage: controller.handleSendMessage,
    onFilePreview: controller.openPreviewModal,
    handleFileAttachments: () => {},
    chatId: controller.currentChatId,
    assistantId: controller.assistantId,
    isLoading: controller.isMessagingLoading,
    disabled: controller.composerLocked,
    controlledAvailableModels: controller.availableModels,
    controlledSelectedModel: controller.selectedModel,
    onControlledSelectedModelChange: controller.setSelectedModel,
    controlledIsModelSelectionReady: controller.isSelectionReady,
    initialSelectedFacetIds: controller.currentChatLastSelectedFacets,
    onFacetSelectionChange: controller.setActiveSelectedFacetIds,
    uploadFiles: controller.uploadFiles,
    uploadError: controller.uploadError,
    maxFiles: controller.maxFiles,
  };

  return (
    <ChatInputControlsProvider value={controller.chatInputControls}>
      <div className="app-shell-skin flex size-full min-w-0 flex-col">
        <div className="chat-header-skin flex items-center justify-between border-b border-theme-border px-4 py-2">
          <DropdownMenu
            id="addin-header-menu"
            align="left"
            items={controller.headerMenuItems}
          />
          <button
            type="button"
            onClick={() => void controller.createNewChat()}
            className="rounded-[var(--theme-radius-control)] bg-theme-bg-tertiary px-3 py-1 text-xs font-medium text-theme-fg-secondary transition-colors hover:bg-theme-bg-hover"
          >
            {t({ id: "officeAddin.chat.newChat", message: "New Chat" })}
          </button>
        </div>

        <ChatErrorBoundary onReset={() => void controller.refetchHistory()}>
          <div
            {...dropzone.getRootProps()}
            className="chat-body-skin relative flex min-h-0 min-w-0 flex-1 flex-col"
            role="region"
            aria-label={t({
              id: "officeAddin.chat.conversation.aria",
              message: "Chat conversation",
            })}
            data-ui="addin-chat-conversation-dropzone"
          >
            <input
              {...dropzone.getInputProps()}
              aria-label={t({
                id: "officeAddin.chat.conversation.dropzone.ariaLabel",
                message: "Drop files anywhere in the conversation to upload",
              })}
            />
            {showDropOverlay ? (
              <div
                className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center overflow-hidden bg-[color:color-mix(in_srgb,var(--theme-shell-chat-body)_75%,transparent)]"
                data-testid="addin-chat-drop-overlay"
              >
                <div className="relative flex flex-col items-center gap-2 px-6 py-5 text-center">
                  <DocumentIcon className="size-10 text-[var(--theme-fg-primary)] drop-shadow-[0_8px_24px_rgba(0,0,0,0.18)]" />
                  <p className="text-sm font-medium text-[var(--theme-fg-primary)]">
                    {t({
                      id: "officeAddin.chat.fileDrop.overlay.label",
                      message: "Drop to upload",
                    })}
                  </p>
                </div>
              </div>
            ) : null}
            {beforeMessages}
            {controller.delegatedRunHeader ? (
              <div className="relative z-10 shrink-0 border-b border-theme-border bg-[var(--theme-shell-page)] p-3">
                {controller.delegatedRunHeader}
              </div>
            ) : null}
            {TopLeftAccessory ? (
              <TopLeftAccessory
                availableModels={controller.availableModels}
                selectedModel={controller.selectedModel}
                onModelChange={controller.setSelectedModel}
                isModelSelectionReady={controller.isSelectionReady}
              />
            ) : null}
            <MessageEditProvider value={controller.messageEditValue}>
              <MessageList
                messages={messages}
                messageOrder={controller.messageOrder}
                loadOlderMessages={() => {}}
                hasOlderMessages={false}
                isPending={controller.isMessagingLoading}
                currentSessionId={controller.currentChatId ?? ""}
                pageSize={6}
                maxWidth={768}
                showTimestamps={true}
                showAvatars={false}
                userProfile={controller.profile ?? undefined}
                controls={controller.resolvedMessageControls}
                messageRenderer={controller.resolvedMessageRenderer}
                controlsContext={controller.controlsContext}
                onMessageAction={controller.standardMessageActionHandler}
                useVirtualization={controller.messageOrder.length > 30}
                virtualizationThreshold={30}
                onFilePreview={controller.openPreviewModal}
                onViewFeedback={feedback.openFeedbackViewDialog}
                className="overscroll-none"
              />
            </MessageEditProvider>
            <DelegatedRunsSection
              chatId={controller.currentChatId}
              onOpenRun={controller.openDelegatedRun}
            />
            {renderInput(inputProps)}
          </div>
        </ChatErrorBoundary>

        <FilePreviewModal
          isOpen={controller.isPreviewModalOpen}
          onClose={controller.closePreviewModal}
          file={controller.fileToPreview}
          relatedFiles={controller.relatedFiles}
        />
        <FeedbackViewDialog
          isOpen={feedback.feedbackViewDialogState.isOpen}
          onClose={feedback.closeFeedbackViewDialog}
          onEdit={feedback.switchToEditMode}
          onRemove={() => void feedback.handleFeedbackViewDialogRemove()}
          feedback={feedback.feedbackViewDialogState.feedback}
          canEdit={
            feedback.feedbackViewDialogState.feedback
              ? feedback.canEditFeedback(
                  feedback.feedbackViewDialogState.feedback,
                )
              : false
          }
          error={feedback.feedbackViewDialogState.error}
        />
        <FeedbackCommentDialog
          isOpen={feedback.feedbackDialogState.isOpen}
          onClose={feedback.closeFeedbackDialog}
          onSubmit={feedback.handleFeedbackDialogSubmit}
          sentiment={feedback.feedbackDialogState.sentiment}
          mode={feedback.feedbackDialogState.mode}
          initialComment={feedback.feedbackDialogState.initialComment}
          error={feedback.feedbackDialogState.error}
        />
        {renderSettings({
          isOpen: controller.isSettingsOpen,
          onClose: () => controller.setIsSettingsOpen(false),
        })}
      </div>
    </ChatInputControlsProvider>
  );
}
