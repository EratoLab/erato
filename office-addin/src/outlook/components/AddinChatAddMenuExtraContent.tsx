import { useChatContext } from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useCallback, useMemo, useState } from "react";

import { useOffice } from "../../providers/OfficeProvider";
import { useOutlookEmailSource } from "../providers/OutlookEmailSourceProvider";
import { useOutlookMailItem } from "../providers/OutlookMailItemProvider";

import type { ChatAddMenuExtraContentProps } from "@erato/frontend/library";

const headerClassName =
  "px-[var(--theme-spacing-dropdown-padding-x)] pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-theme-fg-muted";
// Same row recipe as the shared "+" menu / DropdownMenu item channel, so
// customer themes retune these injected rows together with every other menu.
const rowClassName =
  "dropdown-item-geometry theme-transition flex w-full items-start justify-between gap-2 rounded-[var(--theme-radius-control)] text-left text-sm text-theme-fg-secondary hover:bg-theme-bg-hover hover:text-theme-fg-primary focus:bg-theme-bg-hover focus:text-theme-fg-primary focus:outline-none focus:ring-1 focus:ring-inset focus:ring-theme-border-dropdown disabled:cursor-not-allowed disabled:opacity-50";
const infoRowClassName = "dropdown-item-geometry text-xs";

function formatFileSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) {
    return "0 B";
  }

  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Outlook add-in contribution to the unified chat "+" menu: the email-content
 * sources (the synthesized thread `.eml` and the message's attachments).
 *
 * This is registered as `componentRegistry.ChatAddMenuExtraContent`, so the
 * shared menu owns the file sources (Computer / SharePoint) and tools, and this
 * component only injects the Outlook-specific rows. On a fresh chat the items
 * are auto-suggested, so selecting one *restores* it rather than re-uploading.
 */
export function AddinChatAddMenuExtraContent({
  onSelectFiles,
  onClose,
  disabled = false,
  uploadDisabled = false,
  isProcessing = false,
}: ChatAddMenuExtraContentProps) {
  const { host } = useOffice();
  const { attachments, isLoadingAttachments, getAttachmentFile } =
    useOutlookMailItem();
  const {
    emailBodyFile,
    isThreadEmlStale,
    isLoadingEmailBody,
    emailThreadLoadError,
    isEmailBodyDismissed,
    dismissedAttachmentIds,
    restoreEmailBody,
    restoreAttachment,
  } = useOutlookEmailSource();
  const { currentChatId, messageOrder } = useChatContext();
  const [isUploadingEmailContent, setIsUploadingEmailContent] = useState(false);

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

  const handleSelectEmailBody = useCallback(() => {
    if (!emailBodyFile) {
      return;
    }

    if (isSuggestionEligible) {
      restoreEmailBody();
      onClose();
      return;
    }

    void handleUploadResolvedFiles([emailBodyFile]);
  }, [
    emailBodyFile,
    handleUploadResolvedFiles,
    isSuggestionEligible,
    onClose,
    restoreEmailBody,
  ]);

  const handleSelectAttachment = useCallback(
    (attachmentId: string) => {
      if (isSuggestionEligible) {
        restoreAttachment(attachmentId);
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
    ],
  );

  // Only Outlook surfaces email content; render nothing for other hosts or when
  // there is genuinely nothing to show (no body, no attachments, no error).
  const hasAnyEmailContent =
    !!emailBodyFile ||
    selectableAttachments.length > 0 ||
    isLoadingAttachments ||
    isLoadingEmailBody;

  if (host !== "Outlook" || (!hasAnyEmailContent && !emailThreadLoadError)) {
    return null;
  }

  return (
    <>
      <div className={headerClassName}>
        {t({
          id: "officeAddin.fileSource.emailContent",
          message: "Email content",
        })}
      </div>

      {isLoadingEmailBody && (
        <div className={`${infoRowClassName} text-theme-fg-muted`}>
          {t({
            id: "officeAddin.fileSource.loadingEmailThread",
            message: "Loading email thread...",
          })}
        </div>
      )}

      {!isLoadingEmailBody && emailThreadLoadError && (
        <div className={`${infoRowClassName} text-theme-error-fg`}>
          {t({
            id: "officeAddin.fileSource.emailThreadLoadError",
            message:
              "Couldn't load this conversation from the server. Some messages or attachments may be missing — try reopening the item.",
          })}
        </div>
      )}

      {emailBodyFile &&
        (() => {
          const isAlreadyAdded = isSuggestionEligible && !isEmailBodyDismissed;
          return (
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              data-add-menu-item=""
              onClick={handleSelectEmailBody}
              disabled={
                isBusy ||
                isUploadBlocked ||
                !canUploadEmailContent ||
                isAlreadyAdded
              }
              title={emailBodyFile.name}
              data-testid="addin-add-menu-email-thread"
              className={rowClassName}
            >
              <div className="min-w-0">
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
                    : emailBodyFile.name}
                </div>
              </div>
              <span className="shrink-0 text-xs text-theme-fg-muted">
                {isThreadEmlStale
                  ? t({
                      id: "officeAddin.fileSource.updatingThread",
                      message: "Updating…",
                    })
                  : formatFileSize(emailBodyFile.size)}
              </span>
            </button>
          );
        })()}

      {isLoadingAttachments && (
        <div className={`${infoRowClassName} text-theme-fg-muted`}>
          {t({
            id: "officeAddin.fileSource.loadingAttachments",
            message: "Loading attachments...",
          })}
        </div>
      )}

      {selectableAttachments.map((attachment) => {
        const isCloudAttachment =
          String(attachment.attachmentType).toLowerCase() === "cloud";
        const isAlreadyAdded =
          isSuggestionEligible &&
          !dismissedAttachmentIds.includes(attachment.id);

        return (
          <button
            key={attachment.id}
            type="button"
            role="menuitem"
            tabIndex={-1}
            data-add-menu-item=""
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
            className={rowClassName}
          >
            <div className="min-w-0">
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
            <span className="shrink-0 text-xs text-theme-fg-muted">
              {formatFileSize(attachment.size)}
            </span>
          </button>
        );
      })}
    </>
  );
}
