import {
  ChatErrorBoundary,
  ChatInputControlsProvider,
  ChatMessage,
  DefaultMessageControls,
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

  const { uploadFiles, uploadError } = useFileUploadWithTokenCheck({
    message: "",
    chatId: currentChatId,
    assistantId,
    chatProviderId: selectedModel?.chat_provider_id ?? undefined,
    acceptedFileTypes,
    multiple: true,
  });

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
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-theme-bg-secondary">
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
