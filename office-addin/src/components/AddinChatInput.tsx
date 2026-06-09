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

import { useAvailableActionFacetIds } from "../hooks/useAvailableActionFacets";
import { useOutlookComposeSelection } from "../hooks/useOutlookComposeSelection";
import { useOffice } from "../providers/OfficeProvider";
import { useOutlookEmailSource } from "../providers/OutlookEmailSourceProvider";
import { useOutlookMailItem } from "../providers/OutlookMailItemProvider";
import { resolveOutlookActionFacet } from "../utils/outlookActionFacet";
import { OUTLOOK_REPLY_FROM_READ_FACET_ID } from "../utils/outlookClientActions";
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
  /**
   * Called after a send in which dropped emails were actually attached — i.e.
   * their files uploaded successfully. The owner clears the drop from BOTH the
   * provider drop-state and the AddinChat-owned dedup set (the two live in
   * different layers, so neither can release the other alone). Intentionally
   * NOT called when the email-file upload failed: in that path the message is
   * sent without the emails, so the chips must stay for a retry.
   */
  onEmailSourceDropsSent?: (
    drops: { key: string; messageId: string | null }[],
  ) => void;
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
    onEmailSourceDropsSent,
    ...chatInputProps
  },
  ref,
) {
  const { host } = useOffice();
  const availableFacetIds = useAvailableActionFacetIds();
  const composeEmailAvailable = availableFacetIds.has("compose_email");
  const replyFromReadAvailable = availableFacetIds.has(
    OUTLOOK_REPLY_FROM_READ_FACET_ID,
  );
  const [isUploadingEmail, setIsUploadingEmail] = useState(false);
  const composeSelection = useOutlookComposeSelection();
  const { mailItem, itemIdentity } = useOutlookMailItem();
  const [isSelectionDismissed, setIsSelectionDismissed] = useState(false);
  const hasActiveSelection =
    composeSelection.data.length > 0 && !isSelectionDismissed;

  // Draft-as-context (#1): a non-empty compose body is eligible to ride along
  // as `outlook_review_draft`, but the user can switch it off via the draft
  // chip. Default on; reset to on when the Outlook item changes (a new draft).
  const draftBodyText = mailItem?.bodyText ?? mailItem?.bodyHtml ?? "";
  const [isDraftDismissed, setIsDraftDismissed] = useState(false);
  const lastDraftItemIdentityRef = useRef(itemIdentity);
  if (itemIdentity !== lastDraftItemIdentityRef.current) {
    lastDraftItemIdentityRef.current = itemIdentity;
    setIsDraftDismissed(false);
  }
  const isDraftContextIncluded =
    !!mailItem?.isComposeMode && draftBodyText.length > 0 && !isDraftDismissed;
  // Show the draft chip only when it's actually what we'd send: a live
  // selection takes priority (rewrite wins over review), so hide it then.
  const hasDraftContextChip =
    host === "Outlook" && isDraftContextIncluded && !hasActiveSelection;

  // Draft de-dup marker (#4): the body we last sent as `review_draft` in this
  // chat. Client-side by design — the backend is action-facet toggle-stateless.
  // Reset when the chat changes so a fresh chat re-sends the draft.
  const lastSentDraftBodyRef = useRef<string | null>(null);
  const lastDraftChatIdRef = useRef(chatId);
  if (chatId !== lastDraftChatIdRef.current) {
    // Reset the dedup marker when the chat genuinely changes — but NOT when a
    // brand-new chat just received its id on first send (null → id is the same
    // conversation continuing). Otherwise the second message would needlessly
    // re-send the unchanged draft.
    const isNewChatGettingItsId =
      lastDraftChatIdRef.current == null && chatId != null;
    lastDraftChatIdRef.current = chatId;
    if (!isNewChatGettingItsId) {
      lastSentDraftBodyRef.current = null;
    }
  }

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
    isLoadingEmailBody,
    emailThreadLoadError,
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
  const isWaitingForSuggestedEmail =
    showSuggestedEmailSource &&
    !hasDroppedStagedEmails &&
    isLoadingEmailBody &&
    !emailThreadLoadError;
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
          isLoadingEmailBody ||
          emailThreadLoadError ||
          isLoadingAttachments ||
          parentReplyContext !== null ||
          isLoadingParentReplyContext)));
  const emailSourceGroups = useMemo<FileAttachmentGroup[]>(() => {
    const groups: FileAttachmentGroup[] = [];

    if (
      showSuggestedEmailSource &&
      !hasDroppedStagedEmails &&
      stagedEmails.every((staged) => staged.source !== "current-thread") &&
      (isLoadingEmailBody || emailThreadLoadError)
    ) {
      groups.push({
        id: "current-email-thread-status",
        label:
          emailSubject ||
          t({
            id: "officeAddin.chatInput.emailFallback",
            message: "Email",
          }),
        metaLabel: "",
        items: isLoadingEmailBody
          ? [
              {
                kind: "loading",
                id: "current-email-thread-loading",
                label: t({
                  id: "officeAddin.chatInput.loadingEmailThread",
                  message: "Loading email thread...",
                }),
                description: t({
                  id: "officeAddin.chatInput.loadingEmailThreadDescription",
                  message: "Preparing the email context",
                }),
              },
            ]
          : [
              {
                kind: "status",
                id: "current-email-thread-error",
                tone: "error",
                label: t({
                  id: "officeAddin.chatInput.emailThreadLoadError",
                  message: "Couldn't load the email thread",
                }),
                description: t({
                  id: "officeAddin.chatInput.emailThreadLoadErrorDescription",
                  message: "You can still send without this email context.",
                }),
              },
            ],
      });
    }

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

    // Staged emails: the currently-open Outlook conversation renders as one
    // card with each thread message nested inside (threadMessageGroup items);
    // drag-dropped .eml files render as flat cards (one per drop).
    for (const staged of stagedEmails) {
      if (staged.source === "current-thread") {
        const messageCount = staged.thread.messages.length;
        const items: FileAttachmentGroupItem[] = staged.thread.messages.map(
          (message) => {
            const senderLabel =
              message.from?.name?.trim() ||
              message.from?.address?.trim() ||
              t({
                id: "officeAddin.chatInput.unknownSender",
                message: "Unknown sender",
              });
            const dateLabel = message.date
              ? new Date(message.date).toLocaleString()
              : "";
            const sublabel = [dateLabel, message.subject]
              .filter((part) => part.trim().length > 0)
              .join(" · ");

            const attachmentItems = message.attachments
              .filter((attachment) => !attachment.isInline)
              .map((attachment) => {
                const dismissed = staged.dismissedAttachmentIds.has(
                  attachment.id,
                );
                const validation = validateAttachment(
                  attachment.filename,
                  attachment.mimeType,
                  attachment.size,
                  globalMaxSizeBytes,
                  maxSizeFormatted,
                );
                return {
                  id: attachment.id,
                  file: {
                    id: attachment.id,
                    filename: attachment.filename,
                    size: attachment.size,
                  },
                  selected: !dismissed,
                  onToggle: () => {
                    if (dismissed) {
                      restoreStagedEmailAttachment(message.id, attachment.id);
                    } else {
                      dismissStagedEmailAttachment(message.id, attachment.id);
                    }
                  },
                  validation,
                };
              });

            const messageDismissed = staged.dismissedMessageIds.has(message.id);
            return {
              kind: "threadMessageGroup" as const,
              id: message.id,
              label: senderLabel,
              sublabel,
              selected: !messageDismissed,
              onToggle: () => {
                if (messageDismissed) {
                  restoreStagedEmailBody(message.id);
                } else {
                  dismissStagedEmailBody(message.id);
                }
              },
              defaultCollapsed: true,
              attachments: attachmentItems,
            };
          },
        );

        groups.push({
          id: `staged-email:${staged.key}`,
          label:
            staged.thread.subject ||
            emailSubject ||
            t({
              id: "officeAddin.chatInput.emailFallback",
              message: "Email",
            }),
          metaLabel:
            messageCount === 1 ? t`1 message` : t`${messageCount} messages`,
          items,
          collapsible: true,
          defaultCollapsed: true,
        });
        continue;
      }

      // source === "drop" — one .eml dragged onto the chat, flat layout.
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
    emailThreadLoadError,
    emailSubject,
    globalMaxSizeBytes,
    hasDroppedStagedEmails,
    isEmailBodyIncluded,
    isLoadingAttachments,
    isLoadingEmailBody,
    isLoadingParentReplyContext,
    maxSizeFormatted,
    parentReplyContext,
    restoreStagedEmailAttachment,
    restoreStagedEmailBody,
    selectedAttachmentItems,
    showSuggestedEmailSource,
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
      // Build the action facet (selection rewrite vs. draft review) via a pure
      // resolver so the selection-priority and draft de-dup rules stay testable.
      //
      // `outlook_review_draft` only ever carries the user's OWN draft: compose
      // mode is required (`isDraftContextIncluded`), so a read-mode email body
      // can never leak in. The body is sent as plain text — Outlook compose
      // HTML is bloated with MS tags, inline styles, and base64 images that add
      // no value to a writing-review prompt and blow the backend's per-arg size
      // cap; text coercion still preserves quoted history (`>` lines), bullet
      // lists, and link URLs, so the model keeps the full conversation context.
      const bodyFormat = mailItem ? await getComposeBodyType() : undefined;
      const { facet: actionFacet, sentDraftBody } = resolveOutlookActionFacet({
        hasActiveSelection,
        selectionData: composeSelection.data,
        selectionSource: composeSelection.sourceProperty,
        draftContextIncluded: isDraftContextIncluded,
        draftBody: draftBodyText,
        lastSentDraftBody: lastSentDraftBodyRef.current,
        bodyFormat,
        isComposeMode: !!mailItem?.isComposeMode,
        composeEmailAvailable,
        isReadMode: !!mailItem && !mailItem.isComposeMode,
        replyFromReadAvailable,
      });
      if (sentDraftBody !== null) {
        // Remember what we sent so an unchanged follow-up de-dupes (#4).
        lastSentDraftBodyRef.current = sentDraftBody;
      }

      // Snapshot the dropped emails staged for this send. They are cleared only
      // once we know their files were actually attached (the awaited upload
      // succeeded) — the chat-message dispatch itself is fire-and-forget, so the
      // upload is the meaningful "were these attached?" boundary. Clearing
      // releases both the provider drop-state and the dedup claim via the owner.
      const sentDrops = stagedEmails.flatMap((staged) =>
        staged.source === "drop"
          ? [{ key: staged.key, messageId: staged.parsed.messageId ?? null }]
          : [],
      );
      const clearSentDrops = () => {
        if (sentDrops.length > 0) {
          onEmailSourceDropsSent?.(sentDrops);
        }
      };

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
      let uploadFailed = false;

      try {
        const filesToUpload = await resolveSelectedFilesForSend();
        if (filesToUpload.length === 0) {
          // No files resolved (e.g. only dismissed drops remain), but the
          // action facet must still ride along: the dedup marker was already
          // advanced above, so omitting the facet here would send without it
          // AND then suppress the same unchanged draft on the next send.
          chatInputProps.onSendMessage(
            message,
            inputFileIds,
            modelId,
            selectedFacetIds,
            actionFacet,
          );
          // No upload was attempted (e.g. only dismissed drops remain) and
          // nothing failed, so the staged drops are safe to clear.
          clearSentDrops();
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
        uploadFailed = true;
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

      // Clear the drops only when their files actually uploaded. On a failed
      // upload the message was sent WITHOUT them (see catch), so the chips must
      // remain so the user can retry.
      if (!uploadFailed) {
        clearSentDrops();
      }
    },
    [
      chatId,
      chatInputProps,
      composeEmailAvailable,
      composeSelection.data,
      composeSelection.sourceProperty,
      draftBodyText,
      hasActiveSelection,
      isDraftContextIncluded,
      mailItem,
      onEmailSourceDropsSent,
      replyFromReadAvailable,
      resolveSelectedFilesForSend,
      shouldUseSuggestedEmailSource,
      stagedEmails,
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
        <div className="mx-auto w-full max-w-4xl overflow-hidden overscroll-none px-2 pb-1 sm:px-4">
          <div
            className="max-h-[40vh] overflow-y-auto overscroll-none pr-1 focus:outline-none focus:ring-2 focus:ring-theme-focus"
            role="region"
            // The attachment preview is a bounded scroll area in the task pane;
            // keyboard users need a focus target before arrow/page scrolling.
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
            tabIndex={0}
            aria-label={t({
              id: "officeAddin.chatInput.emailSourcePreviewRegion",
              message: "Email context preview",
            })}
          >
            <GroupedFileAttachmentsPreview
              groups={emailSourceGroups}
              onRemoveFile={handleRemoveEmailSourceFile}
              disabled={isUploadingEmail}
              showFileTypes={true}
              showFileSizes={true}
              defaultVisibleItems={10}
              stickyGroupHeaders={true}
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

      {hasDraftContextChip && (
        <div className="mx-auto w-full max-w-4xl px-2 pb-1 sm:px-4">
          <div className="flex items-center gap-2 rounded-lg border border-theme-border bg-theme-bg-secondary px-3 py-1.5 text-xs text-theme-fg-secondary">
            <span className="shrink-0">&#x1F4DD;</span>
            <span className="min-w-0 truncate">
              {t({
                id: "officeAddin.chatInput.draftContext",
                message: "Your draft is included as context",
              })}
            </span>
            <button
              type="button"
              onClick={() => setIsDraftDismissed(true)}
              className="ml-auto shrink-0 rounded p-0.5 hover:bg-theme-bg-tertiary"
              aria-label={t({
                id: "officeAddin.chatInput.dismissDraftContext",
                message: "Don't include draft",
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
          isWaitingForSuggestedEmail ||
          chatInputProps.disabled
        }
      />
    </div>
  );
});
