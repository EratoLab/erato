import {
  ChatErrorBoundary,
  ChatInputControlsProvider,
  ChatMessage,
  DefaultMessageControls,
  DocumentIcon,
  FeedbackCommentDialog,
  FeedbackViewDialog,
  FilePreviewModal,
  MessageList,
  chatMessagesQuery,
  componentRegistry,
  extractTextFromContent,
  getSupportedFileTypes,
  resolveComponentOverride,
  useActiveModelSelection,
  useChatContext,
  useConversationDropzone,
  useFileCapabilitiesContext,
  useFilePreviewModal,
  useFileUploadWithTokenCheck,
  useMessageFeedback,
  useProfile,
  useStandardMessageActions,
  type ActionFacetRequest,
  type ChatInputControlsHandle,
  type ContentPart,
  type FileUploadItem,
  type MessageAction,
  type MessageControlsComponent,
  type MessageControlsContext,
} from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";

import { AddinChatInput } from "./AddinChatInput";
import { useOfficeDragAndDrop } from "../hooks/useOfficeDragAndDrop";
import { useOutlookMailListDrag } from "../hooks/useOutlookMailListDrag";
import { useMsalNaa } from "../providers/MsalNaaProvider";
import { expandDroppedEmailFiles } from "../utils/expandDroppedEmailFiles";
import { fetchOutlookMessageFiles } from "../utils/fetchOutlookMessage";

import type { OutlookMailListDragItem } from "../utils/outlookMailListDragParse";

const GRAPH_MAIL_SCOPES = ["Mail.Read"];

// Accept real `.eml` / `.msg` files dropped by Outlook clients that expose
// emails as native file drags (Outlook Mac, Classic Outlook on Windows). OWA
// and New Outlook use the custom `maillistrow` path handled separately via
// `useOutlookMailListDrag`.
const EMAIL_MIME_TYPES: Record<string, string[]> = {
  "message/rfc822": [".eml"],
  "application/vnd.ms-outlook": [".msg"],
};

interface AddinChatProps {
  assistantId?: string;
}

export function AddinChat({ assistantId }: AddinChatProps = {}) {
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
      toggleFacetId: (facetId: string) => {
        chatInputControlsRef.current?.toggleFacetId(facetId);
      },
      setSelectedChatProviderId: (chatProviderId: string) => {
        chatInputControlsRef.current?.setSelectedChatProviderId(chatProviderId);
      },
      addUploadedFiles: (files: FileUploadItem[]) => {
        chatInputControlsRef.current?.addUploadedFiles(files);
      },
    }),
    [],
  );

  const {
    messages,
    messageOrder,
    sendMessage,
    editMessage,
    regenerateMessage,
    isMessagingLoading,
    isPendingResponse,
    chats,
    currentChatId,
    createNewChat,
    refetchHistory,
    currentChatLastModel,
  } = useChatContext();
  const { profile } = useProfile();
  const { capabilities } = useFileCapabilitiesContext();

  const { availableModels, selectedModel, setSelectedModel, isSelectionReady } =
    useActiveModelSelection({ initialModel: currentChatLastModel });

  const acceptedFileTypes = useMemo(
    () => getSupportedFileTypes(capabilities),
    [capabilities],
  );

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

  const handleDropUploaded = useCallback((uploaded: FileUploadItem[]) => {
    chatInputControlsRef.current?.addUploadedFiles(uploaded);
  }, []);

  const { acquireToken } = useMsalNaa();
  const acquireGraphToken = useCallback(
    () => acquireToken(GRAPH_MAIL_SCOPES),
    [acquireToken],
  );

  const uploadFilesWithEmailExpansion = useCallback(
    async (files: File[]) => {
      const expanded = await expandDroppedEmailFiles(files, {
        acquireGraphToken,
      });
      return uploadFiles(expanded);
    },
    [acquireGraphToken, uploadFiles],
  );

  const {
    getRootProps: getConversationDropzoneRootProps,
    getInputProps: getConversationDropzoneInputProps,
    isDragActive,
    isDragAccept,
  } = useConversationDropzone({
    uploadFiles: uploadFilesWithEmailExpansion,
    onUploaded: handleDropUploaded,
    acceptedFileTypes,
    extraAcceptMimeTypes: EMAIL_MIME_TYPES,
    isUploading,
  });

  const handleOutlookMailListDrop = useCallback(
    async (items: OutlookMailListDragItem[]) => {
      const collected: File[] = [];
      for (const item of items) {
        try {
          const { files } = await fetchOutlookMessageFiles(
            item.itemId,
            acquireGraphToken,
          );
          collected.push(...files);
        } catch (error) {
          console.warn(
            "Failed to fetch dropped Outlook email, skipping:",
            item.subject || item.itemId,
            error,
          );
        }
      }
      if (collected.length === 0) {
        return;
      }
      const uploaded = await uploadFiles(collected);
      if (uploaded && uploaded.length > 0) {
        chatInputControlsRef.current?.addUploadedFiles(uploaded);
      }
    },
    [acquireGraphToken, uploadFiles],
  );

  const { isDragActive: isOutlookMailDragActive } = useOutlookMailListDrag({
    onDrop: handleOutlookMailListDrop,
  });

  const handleOfficeDragAndDrop = useCallback(
    async (files: File[]) => {
      if (files.length === 0) {
        return;
      }
      const expanded = await expandDroppedEmailFiles(files, {
        acquireGraphToken,
      });
      if (expanded.length === 0) {
        return;
      }
      const uploaded = await uploadFiles(expanded);
      if (uploaded && uploaded.length > 0) {
        chatInputControlsRef.current?.addUploadedFiles(uploaded);
      }
    },
    [acquireGraphToken, uploadFiles],
  );

  const { isDragActive: isOfficeDragActive } = useOfficeDragAndDrop({
    onDrop: handleOfficeDragAndDrop,
  });

  const showDropOverlay =
    (isDragActive && isDragAccept) ||
    isOutlookMailDragActive ||
    isOfficeDragActive;

  const TopLeftAccessory = componentRegistry.ChatTopLeftAccessory;

  const canEditForCurrentChat = Array.isArray(chats)
    ? !!chats.find((chat) => chat.id === (currentChatId ?? ""))?.can_edit
    : false;

  const currentChatLastSelectedFacets = useMemo(() => {
    if (!Array.isArray(chats)) {
      return undefined;
    }

    return chats.find((chat) => chat.id === (currentChatId ?? ""))
      ?.last_selected_facets;
  }, [chats, currentChatId]);

  const [activeSelectedFacetIds, setActiveSelectedFacetIds] = useState<
    string[]
  >(currentChatLastSelectedFacets ?? []);
  const [editState, setEditState] = useState<
    | { mode: "compose" }
    | {
        mode: "edit";
        messageId: string;
        initialContent: ContentPart[];
        initialFiles: FileUploadItem[];
      }
  >({ mode: "compose" });
  const shouldSuggestCurrentEmail =
    currentChatId === null &&
    messageOrder.length === 0 &&
    !isPendingResponse &&
    editState.mode === "compose";

  const handleSendMessage = useCallback(
    (
      message: string,
      inputFileIds?: string[],
      modelId?: string,
      selectedFacetIds?: string[],
      actionFacet?: ActionFacetRequest,
    ) => {
      void sendMessage(
        message,
        inputFileIds,
        modelId,
        assistantId,
        selectedFacetIds,
        actionFacet,
      ).then(() => refetchHistory());
    },
    [assistantId, refetchHistory, sendMessage],
  );

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
      ).finally(() => setEditState({ mode: "compose" }));
    },
    [editMessage],
  );

  const handleRegenerate = useCallback(
    (assistantMessageId: string) => {
      void regenerateMessage(assistantMessageId, activeSelectedFacetIds);
    },
    [activeSelectedFacetIds, regenerateMessage],
  );

  const {
    isPreviewModalOpen,
    fileToPreview,
    openPreviewModal,
    closePreviewModal,
  } = useFilePreviewModal();

  const queryClient = useQueryClient();
  const handleFeedbackSuccess = useCallback(() => {
    if (!currentChatId) {
      return;
    }

    void queryClient.invalidateQueries({
      queryKey: chatMessagesQuery({ pathParams: { chatId: currentChatId } })
        .queryKey,
    });
  }, [currentChatId, queryClient]);

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
  } = useMessageFeedback({ onFeedbackSuccess: handleFeedbackSuccess });

  const handleCopyAction = useCallback(
    async (action: MessageAction): Promise<boolean> => {
      if (action.type !== "copy") {
        return false;
      }
      const messageToCopy = messages[action.messageId];
      const textContent = extractTextFromContent(messageToCopy?.content);
      if (!textContent) {
        return false;
      }

      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(textContent);
        } else {
          throw new Error("clipboard API unavailable");
        }
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
        } catch (fallbackError) {
          console.warn("Failed to copy message content:", fallbackError);
          return false;
        }
      }
    },
    [messages],
  );

  const standardMessageActionHandler = useStandardMessageActions({
    messages,
    setEditState,
    handleRegenerate,
    handleFeedbackSubmit,
    feedbackConfig,
    openFeedbackDialog,
    onUnhandledAction: handleCopyAction,
  });

  const controlsContext: MessageControlsContext = useMemo(
    () => ({
      currentUserId: profile?.id,
      canEdit: canEditForCurrentChat,
    }),
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
      ),
    [],
  );

  return (
    <ChatInputControlsProvider value={chatInputControls}>
      <div className="flex size-full min-w-0 flex-col">
        <div className="flex items-center justify-between border-b border-theme-border px-4 py-2">
          <span className="text-sm font-semibold text-theme-fg-primary">
            {t({
              id: "officeAddin.chat.title",
              message: "Erato",
            })}
          </span>
          <button
            type="button"
            onClick={() => void createNewChat()}
            className="rounded-md bg-theme-bg-tertiary px-3 py-1 text-xs font-medium text-theme-fg-secondary transition-colors hover:bg-theme-bg-hover"
          >
            {t({
              id: "officeAddin.chat.newChat",
              message: "New Chat",
            })}
          </button>
        </div>

        <ChatErrorBoundary onReset={() => void refetchHistory()}>
          <div
            {...getConversationDropzoneRootProps()}
            className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-theme-bg-secondary"
            role="region"
            aria-label={t({
              id: "officeAddin.chat.conversation.aria",
              message: "Chat conversation",
            })}
            data-ui="addin-chat-conversation-dropzone"
          >
            <input
              {...getConversationDropzoneInputProps()}
              aria-label={t({
                id: "officeAddin.chat.conversation.dropzone.ariaLabel",
                message: "Drop files anywhere in the conversation to upload",
              })}
            />
            {showDropOverlay && (
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
            )}
            {TopLeftAccessory ? (
              <TopLeftAccessory
                availableModels={availableModels}
                selectedModel={selectedModel}
                onModelChange={setSelectedModel}
                isModelSelectionReady={isSelectionReady}
              />
            ) : null}
            <MessageList
              messages={messages}
              messageOrder={messageOrder}
              loadOlderMessages={() => {}}
              hasOlderMessages={false}
              isPending={isMessagingLoading}
              currentSessionId={currentChatId ?? ""}
              pageSize={6}
              maxWidth={768}
              showTimestamps={true}
              showAvatars={false}
              userProfile={profile ?? undefined}
              controls={resolvedMessageControls}
              messageRenderer={resolvedMessageRenderer}
              controlsContext={controlsContext}
              onMessageAction={standardMessageActionHandler}
              useVirtualization={messageOrder.length > 30}
              virtualizationThreshold={30}
              onFilePreview={openPreviewModal}
              onViewFeedback={openFeedbackViewDialog}
            />

            <AddinChatInput
              ref={chatInputControlsRef}
              onSendMessage={handleSendMessage}
              onEditMessage={handleEditSubmit}
              onCancelEdit={editState.mode === "edit" ? cancelEdit : undefined}
              onFilePreview={openPreviewModal}
              handleFileAttachments={(_files: FileUploadItem[]) => {}}
              chatId={currentChatId}
              assistantId={assistantId}
              isLoading={isMessagingLoading}
              mode={editState.mode}
              editMessageId={
                editState.mode === "edit" ? editState.messageId : undefined
              }
              editInitialContent={
                editState.mode === "edit" ? editState.initialContent : undefined
              }
              editInitialFiles={
                editState.mode === "edit" ? editState.initialFiles : undefined
              }
              controlledAvailableModels={availableModels}
              controlledSelectedModel={selectedModel}
              onControlledSelectedModelChange={setSelectedModel}
              controlledIsModelSelectionReady={isSelectionReady}
              initialSelectedFacetIds={currentChatLastSelectedFacets}
              onFacetSelectionChange={setActiveSelectedFacetIds}
              showSuggestedEmailSource={shouldSuggestCurrentEmail}
              uploadFiles={uploadFiles}
              uploadError={uploadError}
            />
          </div>
        </ChatErrorBoundary>

        <FilePreviewModal
          isOpen={isPreviewModalOpen}
          onClose={closePreviewModal}
          file={fileToPreview}
        />
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
    </ChatInputControlsProvider>
  );
}
