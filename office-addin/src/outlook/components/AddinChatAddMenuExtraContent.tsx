import {
  PopoverSectionHeader,
  Row,
  formatFileSize,
  useChatContext,
} from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useOffice } from "../../providers/OfficeProvider";
import {
  useOutlookEmailSource,
  type StagedEmail,
} from "../providers/OutlookEmailSourceProvider";
import { useOutlookMailItem } from "../providers/OutlookMailItemProvider";
import {
  matchThreadAttachments,
  type ThreadAttachmentMatch,
} from "../utils/threadAttachmentMatch";

import type { ChatAddMenuExtraContentProps } from "@erato/frontend/library";

/**
 * Outlook add-in contribution to the unified chat "+" menu: the email-content
 * sources (the synthesized thread `.eml` and the message's attachments).
 *
 * This is registered as `componentRegistry.ChatAddMenuExtraContent`, so the
 * shared menu owns the file sources (Computer / SharePoint) and tools, and this
 * component only injects the Outlook-specific rows. On a fresh chat the items
 * are auto-suggested, so selecting one *restores* it rather than re-uploading.
 * Where the open conversation is staged, the rows read and restore the
 * thread card's own ticks.
 */
export function AddinChatAddMenuExtraContent({
  onSelectFiles,
  onClose,
  disabled = false,
  uploadDisabled = false,
  isProcessing = false,
}: ChatAddMenuExtraContentProps) {
  const { host } = useOffice();
  const { mailItem, attachments, isLoadingAttachments, getAttachmentFile } =
    useOutlookMailItem();
  const {
    emailBodyFile,
    isThreadEmlStale,
    isDropResolutionStale,
    isLoadingEmailBody,
    emailThreadLoadError,
    threadTrimError,
    isEmailBodyDismissed,
    dismissedAttachmentIds,
    currentThread,
    stagedEmails,
    restoreEmailBody,
    restoreAttachment,
    restoreStagedEmailBody,
    restoreStagedEmailAttachment,
    dismissStagedEmailAttachment,
  } = useOutlookEmailSource();
  const { currentChatId, messageOrder } = useChatContext();
  const [isUploadingEmailContent, setIsUploadingEmailContent] = useState(false);
  // A follow-up chat uploads the thread file, which a fully unticked thread
  // only has again once the deferred rebuild after the restore has settled.
  const [pendingThreadUpload, setPendingThreadUpload] = useState(false);
  const threadStaged = stagedEmails.find(
    (staged): staged is Extract<StagedEmail, { source: "current-thread" }> =>
      staged.source === "current-thread",
  );
  const isDropStaged = stagedEmails.some((staged) => staged.source === "drop");
  const isThreadUnticked =
    !!threadStaged &&
    threadStaged.thread.messages.every((message) =>
      threadStaged.dismissedMessageIds.has(message.id),
    );

  const isSuggestionEligible =
    host === "Outlook" && currentChatId === null && messageOrder.length === 0;

  const isBusy = disabled || isProcessing || isUploadingEmailContent;
  // Restores only clear a dismissal and ride a separate send-time upload
  // outside the composer's file slots, so the attachment limit gates only
  // genuine uploads.
  const isUploadBlocked = uploadDisabled && !isSuggestionEligible;
  const canUploadEmailContent = !!onSelectFiles;
  const selectableAttachments = useMemo(
    () => attachments.filter((attachment) => !attachment.isInline),
    [attachments],
  );
  const threadMatches = useMemo(
    () =>
      threadStaged
        ? matchThreadAttachments(
            currentThread,
            mailItem?.internetMessageId,
            selectableAttachments,
          )
        : new Map<string, ThreadAttachmentMatch>(),
    [
      currentThread,
      mailItem?.internetMessageId,
      selectableAttachments,
      threadStaged,
    ],
  );

  const handleUploadResolvedFiles = useCallback(
    async (files: File[]) => {
      if (!onSelectFiles || files.length === 0) {
        return;
      }

      setIsUploadingEmailContent(true);
      try {
        await onSelectFiles(files);
        onClose();
      } catch (error) {
        console.warn("Failed to upload Outlook email content:", error);
      } finally {
        setIsUploadingEmailContent(false);
      }
    },
    [onClose, onSelectFiles],
  );

  useEffect(() => {
    if (!pendingThreadUpload) return;
    if (!threadStaged || threadTrimError) {
      setPendingThreadUpload(false);
      return;
    }
    // Wait for the restore to land, then for the rebuild it starts.
    if (isEmailBodyDismissed || isThreadEmlStale) return;
    setPendingThreadUpload(false);
    if (emailBodyFile) {
      void handleUploadResolvedFiles([emailBodyFile]);
    }
  }, [
    emailBodyFile,
    handleUploadResolvedFiles,
    isEmailBodyDismissed,
    isThreadEmlStale,
    pendingThreadUpload,
    threadStaged,
    threadTrimError,
  ]);

  const handleSelectEmailBody = useCallback(() => {
    if (isSuggestionEligible) {
      restoreEmailBody();
      onClose();
      return;
    }

    if (isThreadUnticked) {
      restoreEmailBody();
      // With a drop staged the thread card is on screen and goes with the
      // send already; uploading it as well would send it twice.
      if (isDropStaged) {
        onClose();
      } else {
        setPendingThreadUpload(true);
      }
      return;
    }

    if (!emailBodyFile) {
      return;
    }
    void handleUploadResolvedFiles([emailBodyFile]);
  }, [
    emailBodyFile,
    handleUploadResolvedFiles,
    isDropStaged,
    isSuggestionEligible,
    isThreadUnticked,
    onClose,
    restoreEmailBody,
  ]);

  // An attachment cannot go without its message, and restoring a message
  // brings back every attachment not dismissed one by one; those are
  // dismissed here so only the chosen one is added.
  const restoreThreadAttachment = useCallback(
    (match: ThreadAttachmentMatch) => {
      if (!threadStaged) return;
      if (threadStaged.dismissedMessageIds.has(match.messageId)) {
        const message = threadStaged.thread.messages.find(
          (candidate) => candidate.id === match.messageId,
        );
        for (const sibling of message?.attachments ?? []) {
          if (
            sibling.isInline ||
            sibling.id === match.attachmentId ||
            threadStaged.dismissedAttachmentIds.has(sibling.id)
          ) {
            continue;
          }
          dismissStagedEmailAttachment(match.messageId, sibling.id);
        }
        restoreStagedEmailBody(match.messageId);
      }
      if (threadStaged.dismissedAttachmentIds.has(match.attachmentId)) {
        restoreStagedEmailAttachment(match.messageId, match.attachmentId);
      }
    },
    [
      dismissStagedEmailAttachment,
      restoreStagedEmailAttachment,
      restoreStagedEmailBody,
      threadStaged,
    ],
  );

  const handleSelectAttachment = useCallback(
    (attachmentId: string) => {
      if (isSuggestionEligible) {
        const match = threadMatches.get(attachmentId);
        if (match) {
          restoreThreadAttachment(match);
        } else {
          restoreAttachment(attachmentId);
        }
        onClose();
        return;
      }

      void (async () => {
        try {
          const file = await getAttachmentFile(attachmentId);
          await handleUploadResolvedFiles([file]);
        } catch (error) {
          console.warn(
            "Failed to resolve Outlook attachment for upload:",
            error,
          );
        }
      })();
    },
    [
      getAttachmentFile,
      handleUploadResolvedFiles,
      isSuggestionEligible,
      onClose,
      restoreAttachment,
      restoreThreadAttachment,
      threadMatches,
    ],
  );

  // A thread with every message unticked has no file, but still has a row
  // to bring it back from.
  const hasThreadRow = !!emailBodyFile || !!threadStaged;
  // Only Outlook surfaces email content; render nothing for other hosts or when
  // there is genuinely nothing to show (no body, no attachments, no error).
  const hasAnyEmailContent =
    hasThreadRow ||
    selectableAttachments.length > 0 ||
    isLoadingAttachments ||
    isLoadingEmailBody;

  if (host !== "Outlook" || (!hasAnyEmailContent && !emailThreadLoadError)) {
    return null;
  }

  return (
    <>
      <PopoverSectionHeader>
        {t({
          id: "officeAddin.fileSource.emailContent",
          message: "Email content",
        })}
      </PopoverSectionHeader>

      {isLoadingEmailBody && (
        <Row
          variant="menu"
          as="div"
          interactive={false}
          tone="muted"
          className="text-xs"
        >
          {t({
            id: "officeAddin.fileSource.loadingEmailThread",
            message: "Loading email thread...",
          })}
        </Row>
      )}

      {!isLoadingEmailBody && emailThreadLoadError && (
        <Row
          variant="menu"
          as="div"
          interactive={false}
          tone="error"
          className="text-xs"
        >
          {t({
            id: "officeAddin.fileSource.emailThreadLoadError",
            message:
              "Couldn't load this conversation from the server. Some messages or attachments may be missing — try reopening the item.",
          })}
        </Row>
      )}

      {hasThreadRow &&
        (() => {
          const isAlreadyAdded = isSuggestionEligible && !isEmailBodyDismissed;
          const threadSubject =
            threadStaged?.thread.subject ||
            t({
              id: "officeAddin.chatInput.emailFallback",
              message: "Email",
            });
          const isUpdating =
            pendingThreadUpload || isThreadEmlStale || isDropResolutionStale;
          return (
            <Row
              variant="menu"
              align="start"
              role="menuitem"
              tabIndex={-1}
              onClick={handleSelectEmailBody}
              disabled={
                isBusy ||
                pendingThreadUpload ||
                isUploadBlocked ||
                !canUploadEmailContent ||
                isAlreadyAdded
              }
              title={emailBodyFile?.name ?? threadSubject}
              data-testid="addin-add-menu-email-thread"
              trailing={
                isUpdating || emailBodyFile ? (
                  <span className="shrink-0 text-xs text-theme-fg-muted">
                    {isUpdating
                      ? t({
                          id: "officeAddin.fileSource.updatingThread",
                          message: "Updating…",
                        })
                      : formatFileSize(emailBodyFile?.size ?? 0)}
                  </span>
                ) : undefined
              }
            >
              {/* The body takes the row's free space so a long name truncates
                  rather than pushing at the size text after it. */}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {t({
                    id: "officeAddin.fileSource.emailThread",
                    message: "Email thread",
                  })}
                </div>
                <div className="truncate text-xs text-theme-fg-muted">
                  {isAlreadyAdded
                    ? t({
                        id: "officeAddin.fileSource.alreadyAdded",
                        message: "Already added",
                      })
                    : (emailBodyFile?.name ?? threadSubject)}
                </div>
              </div>
            </Row>
          );
        })()}

      {isLoadingAttachments && (
        <Row
          variant="menu"
          as="div"
          interactive={false}
          tone="muted"
          className="text-xs"
        >
          {t({
            id: "officeAddin.fileSource.loadingAttachments",
            message: "Loading attachments...",
          })}
        </Row>
      )}

      {selectableAttachments.map((attachment) => {
        const isCloudAttachment =
          String(attachment.attachmentType).toLowerCase() === "cloud";
        const match = threadMatches.get(attachment.id);
        const isAlreadyAdded =
          isSuggestionEligible &&
          (match && threadStaged
            ? !threadStaged.dismissedMessageIds.has(match.messageId) &&
              !threadStaged.dismissedAttachmentIds.has(match.attachmentId)
            : !dismissedAttachmentIds.includes(attachment.id));

        return (
          <Row
            key={attachment.id}
            variant="menu"
            align="start"
            role="menuitem"
            tabIndex={-1}
            onClick={() => handleSelectAttachment(attachment.id)}
            disabled={
              isBusy ||
              isUploadBlocked ||
              !canUploadEmailContent ||
              isCloudAttachment ||
              isAlreadyAdded
            }
            title={attachment.name}
            data-testid={`addin-add-menu-attachment-${attachment.id}`}
            trailing={
              <span className="shrink-0 text-xs text-theme-fg-muted">
                {formatFileSize(attachment.size)}
              </span>
            }
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">
                {attachment.name}
              </div>
              <div className="truncate text-xs text-theme-fg-muted">
                {isCloudAttachment
                  ? t({
                      id: "officeAddin.fileSource.cloudAttachmentUnsupported",
                      message:
                        "Cloud attachment cannot be uploaded from Outlook",
                    })
                  : isAlreadyAdded
                    ? t({
                        id: "officeAddin.fileSource.alreadyAdded",
                        message: "Already added",
                      })
                    : attachment.contentType ||
                      t({
                        id: "officeAddin.fileSource.attachmentFallback",
                        message: "Attachment",
                      })}
              </div>
            </div>
          </Row>
        );
      })}
    </>
  );
}
