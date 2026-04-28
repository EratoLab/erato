import {
  ChatInput,
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
import { t } from "@lingui/core/macro";
import { forwardRef, useCallback, useMemo, useRef, useState } from "react";

import { useOutlookComposeSelection } from "../hooks/useOutlookComposeSelection";
import { useOffice } from "../providers/OfficeProvider";
import { useOutlookEmailSource } from "../providers/OutlookEmailSourceProvider";
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
  editInitialFiles?: FileUploadItem[];
  initialModel?: ChatModel | null;
  initialSelectedFacetIds?: string[];
  onFacetSelectionChange?: (selectedFacetIds: string[]) => void;
  showSuggestedEmailSource?: boolean;
  uploadFiles?: (files: File[]) => Promise<FileUploadItem[] | undefined>;
  uploadError?: Error | string | null;
  /**
   * `true` while one or more dropped emails are being expanded or
   * deduplicated. Gates the send button and renders a non-blocking inline
   * indicator so the user knows attachments are still materializing.
   */
  isExpandingDroppedEmails?: boolean;
  /**
   * Forwarded to `ChatInput.virtualFiles`. The add-in passes its previewed
   * email body here so the token estimate covers it without polluting
   * `attachedFilesState`. Pass a memoized array.
   */
  virtualFiles?: File[];
  /**
   * Forwarded to `ChatInput.maxFiles`. The add-in lifts the cap above the
   * web default (5) because Outlook drops expand one email into body + N
   * attachments — a single multi-attachment email saturates 5 quickly.
   */
  maxFiles?: number;
  controlledAvailableModels?: ChatModel[];
  controlledSelectedModel?: ChatModel | null;
  onControlledSelectedModelChange?: (model: ChatModel) => void;
  controlledIsModelSelectionReady?: boolean;
}

export const AddinChatInput = forwardRef<
  ChatInputControlsHandle,
  AddinChatInputProps
>(function AddinChatInput(
  {
    chatId,
    className,
    showSuggestedEmailSource = false,
    editInitialFiles,
    isExpandingDroppedEmails = false,
    ...chatInputProps
  },
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
              labelOverride: t({
                id: "officeAddin.chatInput.emailLabel",
                message: "Email",
              }),
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
      } else if (
        mailItem?.isComposeMode &&
        (mailItem.bodyText || mailItem.bodyHtml)
      ) {
        // Only attach `outlook_review_draft` when the user is composing
        // their own message — the action is meaningless (and a privacy
        // footgun) if applied to a read-mode email the user happens to
        // have open. Backend-side, `full_body` is also capped at 10 KB,
        // but that's a defense-in-depth check; the gate here prevents the
        // received-mail body from ever flowing into the request.
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
            <GroupedFileAttachmentsPreview
              groups={[
                {
                  id: "current-email",
                  label:
                    emailSubject ||
                    t({
                      id: "officeAddin.chatInput.emailFallback",
                      message: "Email",
                    }),
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
          </div>
        )}

      {isExpandingDroppedEmails && (
        <div className="mx-auto w-full max-w-4xl px-2 pb-1 sm:px-4">
          <div
            className="flex items-center gap-2 rounded-lg border border-theme-border bg-theme-bg-secondary px-3 py-1.5 text-xs text-theme-fg-secondary"
            role="status"
            aria-live="polite"
            data-testid="addin-chat-email-expansion-indicator"
          >
            <span
              aria-hidden="true"
              className="inline-block size-3 animate-spin rounded-full border-2 border-theme-border border-t-theme-fg-primary"
            />
            <span className="min-w-0 truncate">
              {t({
                id: "officeAddin.chatInput.expandingDroppedEmails",
                message: "Processing dropped emails…",
              })}
            </span>
          </div>
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
              aria-label={t({
                id: "officeAddin.chatInput.dismissSelection",
                message: "Dismiss selection",
              })}
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
        initialFiles={editInitialFiles ?? []}
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
        disabled={
          isUploadingEmail ||
          isExpandingDroppedEmails ||
          chatInputProps.disabled
        }
      />
    </div>
  );
});
