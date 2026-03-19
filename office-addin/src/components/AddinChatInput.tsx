import {
  ChatInput,
  fetchUploadFile,
  getIdToken,
  type ChatInputControlsHandle,
  type ChatModel,
  type ContentPart,
  type FileType,
  type FileUploadItem,
} from "@erato/frontend/library";
import { forwardRef, useCallback, useState } from "react";

import { useOffice } from "../providers/OfficeProvider";
import { useOutlookMailItem } from "../providers/OutlookMailItemProvider";
import { emailToHtmlFile } from "../utils/emailToFile";

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
  const { mailItem } = useOutlookMailItem();
  const [emailIncluded, setEmailIncluded] = useState(false);
  const [isUploadingEmail, setIsUploadingEmail] = useState(false);

  const wrappedOnSendMessage = useCallback(
    async (
      message: string,
      inputFileIds?: string[],
      modelId?: string,
      selectedFacetIds?: string[],
    ) => {
      if (!emailIncluded || !mailItem) {
        chatInputProps.onSendMessage(
          message,
          inputFileIds,
          modelId,
          selectedFacetIds,
        );
        return;
      }

      setIsUploadingEmail(true);
      let emailFileIds: string[] = [];

      try {
        const emailFile = emailToHtmlFile(mailItem);
        const formData = new FormData();
        formData.append("file", emailFile, emailFile.name);

        const idToken = getIdToken();
        const result = await fetchUploadFile({
          queryParams: chatId ? { chat_id: chatId } : {},
          body: formData as never,
          headers: {
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
        });

        emailFileIds = result.files.map((file) => file.id);
      } catch (error) {
        console.warn("Failed to upload email file, sending without it:", error);
      } finally {
        setIsUploadingEmail(false);
      }

      const mergedFileIds = [...(inputFileIds ?? []), ...emailFileIds];
      chatInputProps.onSendMessage(
        message,
        mergedFileIds.length > 0 ? mergedFileIds : undefined,
        modelId,
        selectedFacetIds,
      );
      setEmailIncluded(false);
    },
    [chatId, chatInputProps, emailIncluded, mailItem],
  );

  return (
    <div className={className ? `flex flex-col ${className}` : "flex flex-col"}>
      {host === "Outlook" && mailItem && (
        <div className="mx-auto flex w-full max-w-4xl items-center gap-2 px-2 pb-1 sm:px-4">
          <button
            type="button"
            onClick={() => setEmailIncluded((previous) => !previous)}
            disabled={isUploadingEmail}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              emailIncluded
                ? "bg-theme-bg-accent text-theme-fg-accent"
                : "bg-theme-bg-tertiary text-theme-fg-muted hover:text-theme-fg-secondary"
            }`}
          >
            {isUploadingEmail ? (
              <span className="inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <span className="text-sm">
                {emailIncluded ? "\u2709\uFE0F" : "\u2709"}
              </span>
            )}
            <span className="max-w-[200px] truncate">
              {mailItem.subject || "(no subject)"}
            </span>
          </button>
        </div>
      )}

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
