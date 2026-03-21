import {
  ChatInput,
  FilePreviewButton,
  FilePreviewLoading,
  fetchUploadFile,
  getIdToken,
  type ChatInputControlsHandle,
  type ChatModel,
  type ContentPart,
  type FileType,
  type FileUploadItem,
} from "@erato/frontend/library";
import { forwardRef, useCallback, useState } from "react";

import { useOutlookEmailSource } from "../hooks/useOutlookEmailSource";
import { useOffice } from "../providers/OfficeProvider";

interface AddinChatInputProps {
  onSendMessage: (
    message: string,
    inputFileIds?: string[],
    modelId?: string,
    selectedFacetIds?: string[],
  ) => void;
  onEditMessage?: (
    messageId: string,
    newContent: string,
    replaceInputFileIds?: string[],
    selectedFacetIds?: string[],
  ) => void;
  onCancelEdit?: () => void;
  handleFileAttachments?: (files: FileUploadItem[]) => void;
  isLoading?: boolean;
  disabled?: boolean;
  className?: string;
  acceptedFileTypes?: FileType[];
  onFilePreview?: (file: FileUploadItem) => void;
  chatId?: string | null;
  assistantId?: string;
  mode?: "compose" | "edit";
  editMessageId?: string;
  editInitialContent?: ContentPart[];
  initialModel?: ChatModel | null;
  initialSelectedFacetIds?: string[];
  onFacetSelectionChange?: (selectedFacetIds: string[]) => void;
}

export const AddinChatInput = forwardRef<
  ChatInputControlsHandle,
  AddinChatInputProps
>(function AddinChatInput({ chatId, className, ...chatInputProps }, ref) {
  const { host } = useOffice();
  const [isUploadingEmail, setIsUploadingEmail] = useState(false);
  const {
    hasSelectedEmailSource,
    isEmailBodyIncluded,
    emailBodyFile,
    selectedAttachmentItems,
    isLoadingAttachments,
    removeEmailBody,
    removeAttachment,
    resolveSelectedFilesForSend,
  } = useOutlookEmailSource();

  const wrappedOnSendMessage = useCallback(
    async (
      message: string,
      inputFileIds?: string[],
      modelId?: string,
      selectedFacetIds?: string[],
    ) => {
      if (!hasSelectedEmailSource) {
        chatInputProps.onSendMessage(
          message,
          inputFileIds,
          modelId,
          selectedFacetIds,
        );
        return;
      }

      setIsUploadingEmail(true);
      let resolvedFileIds: string[] = [];

      try {
        const filesToUpload = await resolveSelectedFilesForSend();
        if (filesToUpload.length === 0) {
          chatInputProps.onSendMessage(
            message,
            inputFileIds,
            modelId,
            selectedFacetIds,
          );
          return;
        }

        const formData = new FormData();
        filesToUpload.forEach((file) => {
          formData.append("file", file, file.name);
        });

        const idToken = getIdToken();
        const result = await fetchUploadFile({
          queryParams: chatId ? { chat_id: chatId } : {},
          body: formData as never,
          headers: {
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
        });

        resolvedFileIds = result.files.map((file) => file.id);
      } catch (error) {
        console.warn(
          "Failed to upload Outlook email source files, sending without them:",
          error,
        );
      } finally {
        setIsUploadingEmail(false);
      }

      const mergedFileIds = [...(inputFileIds ?? []), ...resolvedFileIds];
      chatInputProps.onSendMessage(
        message,
        mergedFileIds.length > 0 ? mergedFileIds : undefined,
        modelId,
        selectedFacetIds,
      );
    },
    [
      chatId,
      chatInputProps,
      hasSelectedEmailSource,
      resolveSelectedFilesForSend,
    ],
  );

  return (
    <div className={className ? `flex flex-col ${className}` : "flex flex-col"}>
      {host === "Outlook" && isEmailBodyIncluded && emailBodyFile && (
        <div className="mx-auto w-full max-w-4xl px-2 pb-1 sm:px-4">
          <FilePreviewButton
            file={emailBodyFile}
            onRemove={removeEmailBody}
            disabled={isUploadingEmail}
            className="w-full"
            showFileType={true}
            showSize={true}
            filenameClassName="max-w-full"
          />
        </div>
      )}

      {host === "Outlook" && isLoadingAttachments && (
        <div className="mx-auto w-full max-w-4xl px-2 pb-1 sm:px-4">
          <FilePreviewLoading
            className="w-full"
            label="Loading attachments..."
          />
        </div>
      )}

      {host === "Outlook" &&
        selectedAttachmentItems.map((attachmentItem) => (
          <div
            key={attachmentItem.id}
            className="mx-auto w-full max-w-4xl px-2 pb-1 sm:px-4"
          >
            <FilePreviewButton
              file={attachmentItem}
              onRemove={() => removeAttachment(attachmentItem.id)}
              disabled={isUploadingEmail}
              className="w-full"
              showFileType={true}
              showSize={true}
              filenameClassName="max-w-full"
            />
          </div>
        ))}

      <ChatInput
        ref={ref}
        className="p-2 sm:p-4"
        showControls={true}
        showFileTypes={true}
        initialFiles={[]}
        chatId={chatId}
        {...chatInputProps}
        onSendMessage={(message, inputFileIds, modelId, selectedFacetIds) => {
          void wrappedOnSendMessage(
            message,
            inputFileIds,
            modelId,
            selectedFacetIds,
          );
        }}
        disabled={isUploadingEmail || chatInputProps.disabled}
      />
    </div>
  );
});
