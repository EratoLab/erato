import {
  ChatErrorBoundary,
  ChatInputControlsProvider,
  ChatMessage,
  DefaultMessageControls,
  DelegatedRunOpenProvider,
  LocalTaskCoordinator,
  DelegatedRunsSection,
  DocumentIcon,
  FeedbackCommentDialog,
  FeedbackViewDialog,
  FilePreviewModal,
  MessageEditProvider,
  MessageList,
  SidebarToggle,
  chatMessagesQuery,
  componentRegistry,
  extractTextFromContent,
  getSupportedFileTypes,
  resolveComponentOverride,
  transformEmailFencesForCopy,
  useActiveModelSelection,
  useChatCanEdit,
  useChatContext,
  useChatHeader,
  useConversationDropzone,
  useFileCapabilitiesContext,
  useFilePreviewModal,
  useFileUploadWithTokenCheck,
  useGenerationIndicatorCount,
  useMessageFeedback,
  useModelSwitches,
  useProfile,
  useStandardMessageActions,
  useUploadFeature,
  type ActionFacetRequest,
  type AssistantMention,
  type ChatInputControlsHandle,
  type ChatMessageProps,
  type DelegatedRunsSectionProps,
  type DelegationRunMode,
  type FileUploadItem,
  type MessageAction,
  type MessageControlsComponent,
  type MessageControlsContext,
  type SidebarToggleProps,
} from "@erato/frontend/library";
import { plural, t } from "@lingui/core/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";

import { AddinChatInputCore } from "./AddinChatInputCore";
import { AddinHistoryDrawerCore } from "./AddinHistoryDrawerCore";
import { AddinSettingsDialogCore } from "./AddinSettingsDialogCore";

import type {
  ComponentProps,
  ComponentType,
  MutableRefObject,
  ReactNode,
} from "react";

// Links the header trigger's aria-controls to the drawer's dialog panel.
const HISTORY_DRAWER_PANEL_ID = "addin-history-drawer-panel";

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
    delegationRunMode?: DelegationRunMode,
    mcpWriteToolsEnabled?: boolean,
    disabledMcpServerIds?: string[],
    disabledMcpTools?: string[],
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
  modelSwitches: ReturnType<typeof useModelSwitches>;
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
  isHistoryMenuOpen: boolean;
  setIsHistoryMenuOpen: (isOpen: boolean) => void;
  /** Strip explaining a state that refuses messages; null when none does. */
  chatHeader: ReactNode;
  /** A run its delegate is still writing, or an archived chat, refuses sends
   * with a 409; closing the composer is how the user learns that. */
  composerLocked: boolean;
  openDelegatedRun: NonNullable<DelegatedRunsSectionProps["onOpenRun"]>;
  /** Opens any chat in-pane via the session controller; also handed to deep
   * surfaces (the trace's open-run affordance) through context. */
  openChatById: (chatId: string) => void;
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
  const openChatById = useCallback(
    (chatId: string) => chat.navigateToChat(chatId),
    [chat],
  );
  const runHeaderOptions = useMemo(
    () => ({ onOpenOrigin: openChatById }),
    [openChatById],
  );
  const { header: chatHeader, composerLocked } = useChatHeader(
    chat.currentChatId,
    runHeaderOptions,
  );
  const openDelegatedRun = useCallback<
    NonNullable<DelegatedRunsSectionProps["onOpenRun"]>
  >((run) => openChatById(run.id), [openChatById]);
  const { availableModels, selectedModel, setSelectedModel, isSelectionReady } =
    useActiveModelSelection({ initialModel: chat.currentChatLastModel });
  const modelSwitches = useModelSwitches(
    chat.messages,
    chat.messageOrder,
    availableModels,
  );
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

  // Edit, regenerate and Share are writes, so they follow the composer's lock:
  // a run its delegate is still writing refuses them exactly as it refuses a send.
  const canEditForCurrentChat =
    useChatCanEdit(chat.currentChatId) && !composerLocked;
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
      delegationRunMode,
      mcpWriteToolsEnabled,
      disabledMcpServerIds,
      disabledMcpTools,
    ) => {
      hostCallbacksRef.current.beforeSend?.(hostContextIdentity);
      // No history refetch here: sendMessage resolves at dispatch, before
      // the server lists the chat, and the messaging pipeline already
      // invalidates the recent-chats listings when the stream completes.
      void chat.sendMessage(
        message,
        inputFileIds,
        modelId,
        assistantId,
        selectedFacetIds,
        actionFacet,
        mentionedAssistants,
        delegationRunMode,
        mcpWriteToolsEnabled,
        disabledMcpServerIds,
        disabledMcpTools,
      );
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
  const [isHistoryMenuOpen, setIsHistoryMenuOpen] = useState(false);

  return {
    assistantId,
    maxFiles,
    chatInputControlsRef,
    chatInputControls,
    hostCallbacksRef,
    messages: chat.messages,
    messageOrder: chat.messageOrder,
    modelSwitches,
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
    isHistoryMenuOpen,
    setIsHistoryMenuOpen,
    chatHeader,
    composerLocked,
    openDelegatedRun,
    openChatById,
  };
}

type ConversationDropzone = ReturnType<typeof useConversationDropzone>;

function NeutralAddinChatHost({ controller }: AddinChatHostProps) {
  const { maxSizeBytes, maxSizeFormatted } = useUploadFeature();
  const dropzone = useConversationDropzone({
    uploadFiles: controller.uploadFiles,
    onUploaded: (files) => controller.chatInputControls.addUploadedFiles(files),
    acceptedFileTypes: controller.acceptedFileTypes,
    isUploading: controller.isUploading,
    disabled: controller.composerLocked,
    maxSize: maxSizeBytes,
    maxSizeFormatted,
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
            delegationRunMode,
            mcpWriteToolsEnabled,
            disabledMcpServerIds,
            disabledMcpTools,
          ) =>
            props.onSendMessage(
              message,
              inputFileIds,
              modelId,
              selectedFacetIds,
              undefined,
              undefined,
              mentionedAssistants,
              delegationRunMode,
              mcpWriteToolsEnabled,
              disabledMcpServerIds,
              disabledMcpTools,
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
  drawerSectionsBeforeHistory,
  drawerSectionsAfterHistory,
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
  /** Forwarded into the history drawer's future-section slots. */
  drawerSectionsBeforeHistory?: ReactNode;
  drawerSectionsAfterHistory?: ReactNode;
}) {
  const { maxSizeFormatted } = useUploadFeature();
  const TopLeftAccessory = componentRegistry.ChatTopLeftAccessory;
  // When a kit registers a start view, its toggle floats at the top RIGHT
  // (mirroring the drawer trigger), so the trigger-clearance rows need the
  // symmetric pr-10 as well.
  const hasStartViewToggle = componentRegistry.AddinStartView !== null;
  const feedback = controller.feedback;
  const { setIsHistoryMenuOpen, setIsSettingsOpen } = controller;
  // Stable identities for the drawer: fresh arrows here would churn its
  // onClose/onOpenSettings props every render and defeat the stable-handler
  // contract its list memoization depends on.
  const closeHistoryDrawer = useCallback(
    () => setIsHistoryMenuOpen(false),
    [setIsHistoryMenuOpen],
  );
  const openSettingsFromDrawer = useCallback(
    () => setIsSettingsOpen(true),
    [setIsSettingsOpen],
  );
  // With the drawer shut no row carries a status dot, so this is the pane's
  // only aggregate signal. The name says the count; the badge is aria-hidden.
  const attentionCount = useGenerationIndicatorCount();
  // One bag for both placements: they differ in paint and position only.
  const historyTriggerProps = {
    expanded: controller.isHistoryMenuOpen,
    // Sits behind the open drawer, where a flipped chevron points at nothing —
    // and it never flipped before the primitive existed.
    flipOnExpand: false,
    onClick: () => setIsHistoryMenuOpen(true),
    label:
      attentionCount > 0
        ? t({
            id: "officeAddin.historyDrawer.openWithAttention",
            message: plural(attentionCount, {
              one: "Open menu, # chat needs attention",
              other: "Open menu, # chats need attention",
            }),
          })
        : t({
            id: "officeAddin.historyDrawer.open",
            message: "Open menu",
          }),
    attentionCount,
    badgeTestId: "addin-history-drawer-attention-badge",
    "aria-haspopup": "dialog",
    "aria-controls": HISTORY_DRAWER_PANEL_ID,
    "data-testid": "addin-history-drawer-trigger",
  } satisfies Omit<SidebarToggleProps, "surface" | "className">;
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
      {/* Deep message surfaces (the trace's open-run affordance) open chats
          through the session controller instead of routes the pane lacks. */}
      <DelegatedRunOpenProvider onOpen={controller.openChatById}>
        <LocalTaskCoordinator />
        <div className="app-shell-skin relative flex size-full min-w-0 flex-col">
          {TopLeftAccessory ? (
            // A kit accessory earns a header row and the trigger joins it in
            // flow, so neither can land on the other at any pane width.
            // pr-12, not pr-10: the start-view toggle is 8px plus up to 36px.
            <div
              className={`flex min-w-0 items-center${hasStartViewToggle ? " pr-12" : ""}`}
              data-ui="addin-chat-header"
            >
              {/* In flow beside the accessory, where the frame is all the
                  separation the trigger needs. */}
              <SidebarToggle
                {...historyTriggerProps}
                surface="framed"
                className="relative my-2 ml-2 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <TopLeftAccessory
                  availableModels={controller.availableModels}
                  selectedModel={controller.selectedModel}
                  onModelChange={controller.setSelectedModel}
                  isModelSelectionReady={controller.isSelectionReady}
                />
              </div>
            </div>
          ) : (
            /* Floats over the conversation: the pane is too narrow to spend
               a header row on a single trigger, and New Chat lives in the
               drawer it opens. */
            <SidebarToggle
              {...historyTriggerProps}
              surface="floating"
              className="absolute left-2 top-2 z-20"
            />
          )}

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
                    {maxSizeFormatted && (
                      <p
                        className="text-xs text-[var(--theme-fg-muted)]"
                        data-testid="addin-chat-drop-overlay-max-size"
                      >
                        {t({
                          id: "officeAddin.chat.fileDrop.overlay.maxSize",
                          message: `Maximum file size: ${maxSizeFormatted}`,
                        })}
                      </p>
                    )}
                  </div>
                </div>
              ) : null}
              {beforeMessages}
              {controller.chatHeader ? (
                // pl-10 clears the floating drawer trigger, which otherwise
                // sits on the header's title; with a header row the trigger
                // is in flow and needs no clearance.
                <div
                  className={`relative z-10 shrink-0 border-b border-theme-border bg-[var(--theme-shell-page)] p-3${TopLeftAccessory ? "" : " pl-10"}${hasStartViewToggle && !TopLeftAccessory ? " pr-10" : ""}`}
                >
                  {controller.chatHeader}
                </div>
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
                  modelSwitches={controller.modelSwitches}
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
          <AddinHistoryDrawerCore
            isOpen={controller.isHistoryMenuOpen}
            onClose={closeHistoryDrawer}
            onOpenSettings={openSettingsFromDrawer}
            panelId={HISTORY_DRAWER_PANEL_ID}
            sectionsBeforeHistory={drawerSectionsBeforeHistory}
            sectionsAfterHistory={drawerSectionsAfterHistory}
          />
        </div>
      </DelegatedRunOpenProvider>
    </ChatInputControlsProvider>
  );
}
