import {
  ChatInput,
  FileTypeUtil,
  GroupedFileAttachmentsPreview,
  fetchUploadFile,
  getIdToken,
  useUploadFeature,
  type ChatInputControlsHandle,
  type ChatModel,
  type ContentPart,
  type FileAttachmentGroup,
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

function validateAttachment(
  filename: string,
  mimeType: string,
  size: number,
  globalMaxBytes: number,
  globalMaxFormatted: string,
): { ok: true } | { ok: false; reason: string } {
  // Apply the backend's global cap first — per-type static caps in
  // FileTypeUtil are typically more permissive, so the global is what
  // most uploads will hit. Surfacing the actual server-side cap means
  // the user sees the same message they'd get on a post-upload 413.
  if (globalMaxBytes > 0 && size > globalMaxBytes) {
    return {
      ok: false,
      reason: t({
        id: "officeAddin.chatInput.validation.tooLarge",
        message: `File exceeds the server limit of ${globalMaxFormatted}`,
      }),
    };
  }
  const result = FileTypeUtil.validateMetadata({ filename, mimeType, size });
  if (!result.valid) {
    return { ok: false, reason: result.error ?? "Invalid file" };
  }
  return { ok: true };
}

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
    parentReplyContext,
    isLoadingParentReplyContext,
    stagedEmails,
    dismissStagedEmailAttachment,
    restoreStagedEmailAttachment,
    dismissStagedEmailBody,
    restoreStagedEmailBody,
  } = useOutlookEmailSource();
  const { maxSizeBytes: globalMaxSizeBytes, maxSizeFormatted } =
    useUploadFeature();
  // Drop-staged emails are always user-driven, so they bypass the
  // `showSuggestedEmailSource` gate (which is for the auto-suggest of the
  // currently-open email when the chat is still fresh). Without this the
  // preview region stays hidden after a drop into a chat that already has
  // messages.
  const hasDroppedStagedEmails = stagedEmails.some(
    (staged) => staged.source === "drop",
  );
  const shouldUseSuggestedEmailSource =
    (showSuggestedEmailSource && hasSelectedEmailSource) ||
    hasDroppedStagedEmails;
  // Render the email-source preview whenever there is *something* to show:
  // a real attachment, an in-flight attachment fetch, or the reply-context
  // chip (resolved or still loading). Without this gate the preview region
  // would render an empty card whenever the host is Outlook in compose
  // mode but Graph hasn't yet returned a parent message.
  const shouldShowEmailSourcePreview =
    host === "Outlook" &&
    (hasDroppedStagedEmails ||
      (showSuggestedEmailSource &&
        (hasSelectedEmailSource ||
          isLoadingAttachments ||
          parentReplyContext !== null ||
          isLoadingParentReplyContext)));
  const emailSourceGroups = useMemo<FileAttachmentGroup[]>(() => {
    const groups: FileAttachmentGroup[] = [];

    // Reply-context chip (compose mode) — read-only, not threaded into
    // `resolveSelectedFilesForSend` (the parent body reaches the LLM via
    // the `outlook_review_draft.full_body` action facet).
    if (parentReplyContext || isLoadingParentReplyContext) {
      const items: FileAttachmentGroupItem[] = [];
      if (parentReplyContext) {
        const senderLabel =
          parentReplyContext.fromName?.trim() ||
          parentReplyContext.fromAddress?.trim() ||
          "";
        const subjectLabel =
          parentReplyContext.subject.trim() ||
          t({
            id: "officeAddin.chatInput.replyContext.untitled",
            message: "(no subject)",
          });
        items.push({
          kind: "context",
          id: "reply-context",
          file: {
            id: "reply-context",
            filename: subjectLabel,
            displayName: senderLabel
              ? `${subjectLabel} — ${senderLabel}`
              : subjectLabel,
          },
          labelOverride: t({
            id: "officeAddin.chatInput.replyContext.label",
            message: "Reply context",
          }),
        });
      } else {
        items.push({ kind: "loading", id: "reply-context-loading" });
      }
      groups.push({
        id: "reply-context",
        label: t({
          id: "officeAddin.chatInput.replyContext.groupLabel",
          message: "Reply context",
        }),
        metaLabel: "",
        items,
      });
    }

    // Staged emails (currently-open + future dropped). Each renders as its
    // own grouped card with selectable rows for the .eml body and each
    // in-eml attachment. Selection state is captured locally in Phase 1;
    // surgical MIME removal in Phase 2 will honour deselections in the
    // upload payload.
    for (const staged of stagedEmails) {
      const items: FileAttachmentGroupItem[] = [];

      items.push({
        kind: "selectableAttachment",
        id: `${staged.key}:body`,
        file: {
          id: `${staged.key}:body`,
          filename: staged.parsed.rawEmlFile.name,
          displayName: t({
            id: "officeAddin.chatInput.emailBody",
            message: "Email body",
          }),
          size: staged.parsed.rawEmlFile.size,
        },
        selected: !staged.bodyDismissed,
        onToggle: () => {
          if (staged.bodyDismissed) {
            restoreStagedEmailBody(staged.key);
          } else {
            dismissStagedEmailBody(staged.key);
          }
        },
        labelOverride: t({
          id: "officeAddin.chatInput.emailLabel",
          message: "Email",
        }),
      });

      for (const attachment of staged.parsed.attachments) {
        if (attachment.disposition === "inline" || attachment.related) {
          continue;
        }
        const isDismissed = staged.dismissedAttachmentIds.has(attachment.id);
        const validation = validateAttachment(
          attachment.filename,
          attachment.mimeType,
          attachment.size,
          globalMaxSizeBytes,
          maxSizeFormatted,
        );
        items.push({
          kind: "selectableAttachment",
          id: `${staged.key}:${attachment.id}`,
          file: {
            id: `${staged.key}:${attachment.id}`,
            filename: attachment.filename,
            size: attachment.size,
          },
          selected: !isDismissed,
          onToggle: () => {
            if (isDismissed) {
              restoreStagedEmailAttachment(staged.key, attachment.id);
            } else {
              dismissStagedEmailAttachment(staged.key, attachment.id);
            }
          },
          validation,
        });
      }

      const fromLabel = staged.parsed.from
        ? staged.parsed.from.name || staged.parsed.from.address
        : "";
      const dateLabel = staged.parsed.date
        ? new Date(staged.parsed.date).toLocaleDateString()
        : "";
      const metaParts = [fromLabel, dateLabel].filter(
        (part) => part.length > 0,
      );

      groups.push({
        id: `staged-email:${staged.key}`,
        label:
          staged.parsed.subject ||
          emailSubject ||
          t({
            id: "officeAddin.chatInput.emailFallback",
            message: "Email",
          }),
        metaLabel: metaParts.join(" • "),
        items,
        collapsible: true,
        defaultCollapsed: true,
      });
    }

    // Office.js compose-mode attachments fallback. These are only relevant
    // when no `.eml` is staged (compose mode); in read mode they would be
    // redundant copies of the in-eml attachments shown in the staged group.
    if (stagedEmails.length === 0) {
      const items: FileAttachmentGroupItem[] = [];

      if (isEmailBodyIncluded && emailBodyFile) {
        items.push({
          kind: "attachment",
          id: "email-body",
          file: {
            id: "email-body",
            filename: emailBodyFile.name,
            displayName: "Email thread",
            size: emailBodyFile.size,
          },
          labelOverride: t({
            id: "officeAddin.chatInput.emailLabel",
            message: "Email",
          }),
        });
      }

      for (const attachmentItem of selectedAttachmentItems) {
        items.push({
          kind: "attachment",
          id: attachmentItem.id,
          file: attachmentItem,
        });
      }

      if (isLoadingAttachments) {
        items.push({ kind: "loading", id: "attachments-loading" });
      }

      if (items.length > 0) {
        groups.push({
          id: "current-email-fallback",
          label:
            emailSubject ||
            t({
              id: "officeAddin.chatInput.emailFallback",
              message: "Email",
            }),
          metaLabel: "",
          items,
        });
      }
    }

    return groups;
  }, [
    dismissStagedEmailAttachment,
    dismissStagedEmailBody,
    emailBodyFile,
    emailSubject,
    globalMaxSizeBytes,
    isEmailBodyIncluded,
    isLoadingAttachments,
    isLoadingParentReplyContext,
    maxSizeFormatted,
    parentReplyContext,
    restoreStagedEmailAttachment,
    restoreStagedEmailBody,
    selectedAttachmentItems,
    stagedEmails,
  ]);

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
        // have open. The gate here prevents the received-mail body from
        // ever flowing into the request.
        //
        // Always send the body as plain text. Outlook compose HTML is
        // bloated with MS-specific tags, inline styles, and base64-encoded
        // images that have no semantic value for a writing-review prompt
        // — and they easily push a 5-line reply over a long thread past
        // the backend's per-arg size cap. The text coercion preserves
        // quoted history (as `>` lines), bullet lists, and link URLs, so
        // the LLM still sees the full conversation context.
        const fullBody = mailItem.bodyText ?? mailItem.bodyHtml ?? "";
        actionFacet = {
          id: "outlook_review_draft",
          args: {
            full_body: fullBody,
            body_format: "text",
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
      {shouldShowEmailSourcePreview && (
        <div className="mx-auto w-full max-w-4xl px-2 pb-1 sm:px-4">
          <div className="max-h-[40vh] overflow-y-auto pr-1">
            <GroupedFileAttachmentsPreview
              groups={emailSourceGroups}
              onRemoveFile={handleRemoveEmailSourceFile}
              disabled={isUploadingEmail}
              showFileTypes={true}
              showFileSizes={true}
              defaultVisibleItems={10}
            />
          </div>
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
