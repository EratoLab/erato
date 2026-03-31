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
  extractTextFromContent,
  useChatActions,
  useChatContext,
  useFilePreviewModal,
  useMessageFeedback,
  useProfile,
  type ActionFacetRequest,
  type ChatInputControlsHandle,
  type ContentPart,
  type FileUploadItem,
  type MessageAction,
  type MessageControlsContext,
} from "@erato/frontend/library";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";

import { AddinChatInput } from "./AddinChatInput";

export function AddinChat() {
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
    chats,
    currentChatId,
    navigateToChat,
    createNewChat,
    refetchHistory,
    currentChatLastModel,
    uploadFiles,
    uploadError,
  } = useChatContext();
  const { profile } = useProfile();

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
    | { mode: "edit"; messageId: string; initialContent: ContentPart[] }
  >({ mode: "compose" });
  const shouldSuggestCurrentEmail =
    currentChatId === null &&
    messageOrder.length === 0 &&
    editState.mode === "compose";

  const { handleMessageAction } = useChatActions({
    switchSession: navigateToChat,
    sendMessage,
  });

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
        undefined,
        selectedFacetIds,
        actionFacet,
      ).then(() => refetchHistory());
    },
    [refetchHistory, sendMessage],
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

  const controlsContext: MessageControlsContext = useMemo(
    () => ({
      currentUserId: profile?.id,
      canEdit: canEditForCurrentChat,
    }),
    [canEditForCurrentChat, profile?.id],
  );

  return (
    <ChatInputControlsProvider value={chatInputControls}>
      <div className="flex size-full min-w-0 flex-col">
        <div className="flex items-center justify-between border-b border-theme-border px-4 py-2">
          <span className="text-sm font-semibold text-theme-fg-primary">
            Erato
          </span>
          <button
            type="button"
            onClick={() => void createNewChat()}
            className="rounded-md bg-theme-bg-tertiary px-3 py-1 text-xs font-medium text-theme-fg-secondary transition-colors hover:bg-theme-bg-hover"
          >
            New Chat
          </button>
        </div>

        <ChatErrorBoundary onReset={() => void refetchHistory()}>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-theme-bg-secondary">
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
              controls={DefaultMessageControls}
              messageRenderer={ChatMessage}
              controlsContext={controlsContext}
              onMessageAction={async (action: MessageAction) => {
                if (action.type === "edit") {
                  const messageToEdit = messages[action.messageId];
                  if (messageToEdit?.role === "user") {
                    setEditState({
                      mode: "edit",
                      messageId: action.messageId,
                      initialContent: messageToEdit.content,
                    });
                  }
                  return true;
                }

                if (action.type === "regenerate") {
                  handleRegenerate(action.messageId);
                  return true;
                }

                if (action.type === "copy") {
                  const messageToCopy = messages[action.messageId];
                  const textContent = extractTextFromContent(
                    messageToCopy?.content,
                  );
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
                      console.warn(
                        "Failed to copy message content:",
                        fallbackError,
                      );
                      return false;
                    }
                  }
                }

                if (action.type === "like" || action.type === "dislike") {
                  const sentiment =
                    action.type === "like" ? "positive" : "negative";
                  const result = await handleFeedbackSubmit(
                    action.messageId,
                    sentiment,
                  );
                  if (result.success && feedbackConfig.commentsEnabled) {
                    openFeedbackDialog(action.messageId, sentiment);
                  }
                  return result.success;
                }

                return handleMessageAction(action);
              }}
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
              isLoading={isMessagingLoading}
              mode={editState.mode}
              editMessageId={
                editState.mode === "edit" ? editState.messageId : undefined
              }
              editInitialContent={
                editState.mode === "edit" ? editState.initialContent : undefined
              }
              initialModel={currentChatLastModel}
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
