import {
  ChatInput,
  FilePreviewButton,
  FilePreviewLoading,
  GroupedFileAttachmentsPreview,
  fetchUploadFile,
  getIdToken,
  type ChatInputControlsHandle,
  type ChatModel,
  type ContentPart,
  type FileAttachmentGroupItem,
  type ActionFacetRequest,
  type FileType,
  type FileUploadItem,
} from "@erato/frontend/library";
import { forwardRef, useCallback, useMemo, useRef, useState } from "react";

import { useOutlookComposeSelection } from "../hooks/useOutlookComposeSelection";
import { useOutlookEmailSource } from "../hooks/useOutlookEmailSource";
import { useOffice } from "../providers/OfficeProvider";
import { useOutlookMailItem } from "../providers/OutlookMailItemProvider";
import { getComposeBodyType } from "../utils/outlookComposeWrite";

interface AddinChatInputProps {
  onSendMessage: (
    message: string,
    inputFileIds?: string[],
    modelId?: string,
    selectedFacetIds?: string[],
    actionFacet?: ActionFacetRequest,
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
  showSuggestedEmailSource?: boolean;
  uploadFiles?: (files: File[]) => Promise<FileUploadItem[] | undefined>;
  uploadError?: Error | string | null;
}

export const AddinChatInput = forwardRef<
  ChatInputControlsHandle,
  AddinChatInputProps
>(function AddinChatInput(
  { chatId, className, showSuggestedEmailSource = false, ...chatInputProps },
  ref,
) {
  const { host } = useOffice();
  const [isUploadingEmail, setIsUploadingEmail] = useState(false);
  const composeSelection = useOutlookComposeSelection();
  const { mailItem } = useOutlookMailItem();
  const [isSelectionDismissed, setIsSelectionDismissed] = useState(false);
  const hasActiveSelection =
    composeSelection.data.length > 0 && !isSelectionDismissed;

  // Reset dismiss when selection changes (user selects new text)
  const lastSelectionDataRef = useRef(composeSelection.data);
  if (
    composeSelection.data !== lastSelectionDataRef.current &&
    composeSelection.data.length > 0
  ) {
    lastSelectionDataRef.current = composeSelection.data;
    setIsSelectionDismissed(false);
  }
  const {
    hasSelectedEmailSource,
    isEmailBodyIncluded,
    emailBodyFile,
    emailSubject,
    selectedAttachmentItems,
    isLoadingAttachments,
    removeEmailBody,
    removeAttachment,
    resolveSelectedFilesForSend,
  } = useOutlookEmailSource();
  const shouldUseSuggestedEmailSource =
    showSuggestedEmailSource && hasSelectedEmailSource;
  const emailSourceItems = useMemo(() => {
    return [
      ...(isEmailBodyIncluded && emailBodyFile
        ? [
            {
              id: "email-body",
              file: {
                id: "email-body",
                filename: emailBodyFile.name,
                displayName: "Email thread",
                size: emailBodyFile.size,
              },
              isLoading: false,
            },
          ]
        : []),
      ...selectedAttachmentItems.map((attachmentItem) => ({
        id: attachmentItem.id,
        file: attachmentItem,
        isLoading: false,
      })),
      ...(isLoadingAttachments
        ? [
            {
              id: "attachments-loading",
              file: {
                id: "attachments-loading",
                filename: "attachments-loading",
              },
              isLoading: true,
            },
          ]
        : []),
    ];
  }, [
    emailBodyFile,
    isEmailBodyIncluded,
    isLoadingAttachments,
    selectedAttachmentItems,
  ]) as FileAttachmentGroupItem[];

  const handleRemoveEmailSourceFile = useCallback(
    (fileId: string) => {
      if (fileId === "email-body") {
        removeEmailBody();
        return;
      }

      removeAttachment(fileId);
    },
    [removeAttachment, removeEmailBody],
  );

  const wrappedOnSendMessage = useCallback(
    async (
      message: string,
      inputFileIds?: string[],
      modelId?: string,
      selectedFacetIds?: string[],
    ) => {
      // Build action facet payload: selection-based rewrite or full-body review
      let actionFacet: ActionFacetRequest | undefined;
      const bodyFormat = mailItem ? await getComposeBodyType() : undefined;

      if (hasActiveSelection) {
        actionFacet = {
          id: "outlook_rewrite_selection",
          args: {
            selected_text: composeSelection.data,
            source_property: composeSelection.sourceProperty,
            ...(bodyFormat ? { body_format: bodyFormat } : {}),
          },
        };
      } else if (mailItem?.bodyText || mailItem?.bodyHtml) {
        const fullBody =
          bodyFormat === "html"
            ? (mailItem.bodyHtml ?? mailItem.bodyText ?? "")
            : (mailItem.bodyText ?? mailItem.bodyHtml ?? "");
        actionFacet = {
          id: "outlook_review_draft",
          args: {
            full_body: fullBody,
            body_format: bodyFormat ?? "text",
          },
        };
      }

      if (!shouldUseSuggestedEmailSource) {
        chatInputProps.onSendMessage(
          message,
          inputFileIds,
          modelId,
          selectedFacetIds,
          actionFacet,
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
        actionFacet,
      );
    },
    [
      chatId,
      chatInputProps,
      composeSelection.data,
      composeSelection.sourceProperty,
      hasActiveSelection,
      mailItem,
      resolveSelectedFilesForSend,
      shouldUseSuggestedEmailSource,
    ],
  );

  return (
    <div
      className={
        className
          ? `flex min-w-0 flex-col ${className}`
          : "flex min-w-0 flex-col"
      }
    >
      {host === "Outlook" &&
        showSuggestedEmailSource &&
        (hasSelectedEmailSource || isLoadingAttachments) && (
          <div className="mx-auto w-full max-w-4xl px-2 pb-1 sm:px-4">
            {emailSourceItems.length === 1 ? (
              emailSourceItems[0].isLoading ? (
                <FilePreviewLoading
                  className="w-full"
                  label="Loading attachments..."
                />
              ) : (
                <FilePreviewButton
                  file={emailSourceItems[0].file}
                  onRemove={() =>
                    handleRemoveEmailSourceFile(emailSourceItems[0].id)
                  }
                  disabled={isUploadingEmail}
                  className="w-full"
                  showFileType={true}
                  showSize={true}
                  filenameClassName="max-w-full"
                />
              )
            ) : (
              <GroupedFileAttachmentsPreview
                groups={[
                  {
                    id: "current-email",
                    label: emailSubject || "Email",
                    metaLabel: "",
                    items: emailSourceItems,
                  },
                ]}
                onRemoveFile={handleRemoveEmailSourceFile}
                disabled={isUploadingEmail}
                showFileTypes={true}
                showFileSizes={true}
                defaultVisibleItems={3}
              />
            )}
          </div>
        )}

      {host === "Outlook" && hasActiveSelection && (
        <div className="mx-auto w-full max-w-4xl px-2 pb-1 sm:px-4">
          <div className="flex items-center gap-2 rounded-lg border border-theme-border bg-theme-bg-secondary px-3 py-1.5 text-xs text-theme-fg-secondary">
            <span className="shrink-0">&#x2702;</span>
            <span className="min-w-0 truncate">
              &ldquo;{composeSelection.data.slice(0, 80)}
              {composeSelection.data.length > 80 ? "..." : ""}&rdquo;
            </span>
            <button
              type="button"
              onClick={() => setIsSelectionDismissed(true)}
              className="ml-auto shrink-0 rounded p-0.5 hover:bg-theme-bg-tertiary"
              aria-label="Dismiss selection"
            >
              &#x2715;
            </button>
          </div>
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
        uploadFiles={chatInputProps.uploadFiles}
        uploadError={chatInputProps.uploadError}
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
