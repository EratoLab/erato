import {
  PopoverSectionHeader,
  Row,
  formatFileSize,
} from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useCallback, useMemo, useState } from "react";

import { useOutlookComposerMenu } from "./OutlookComposerMenuContext";
import { useOffice } from "../../providers/OfficeProvider";
import {
  useOutlookEmailSource,
  type StagedEmail,
} from "../providers/OutlookEmailSourceProvider";
import { useOutlookMailItem } from "../providers/OutlookMailItemProvider";
import { matchThreadAttachments } from "../utils/threadAttachmentMatch";

import type { ChatAddMenuExtraContentProps } from "@erato/frontend/library";

const inComposerText = () =>
  t({
    id: "officeAddin.fileSource.inComposer",
    message: "Already in the composer: use its chip",
  });

/**
 * Outlook add-in contribution to the unified chat "+" menu: the email-content
 * sources (the open thread and the item's attachments).
 *
 * Registered as `componentRegistry.ChatAddMenuExtraContent`, so the shared
 * menu owns the file sources and tools, and this component only injects the
 * Outlook rows. It only adds what has no chip: the composer's chips are the
 * one way back for the open email, its thread and its attachments, so their
 * rows here say so. The thread already sent in this chat can be added again,
 * and its attachments uploaded as separate files.
 */
export function AddinChatAddMenuExtraContent({
  onSelectFiles,
  onClose,
  disabled = false,
  uploadDisabled = false,
  isProcessing = false,
}: ChatAddMenuExtraContentProps) {
  const menu = useOutlookComposerMenu();
  const { host } = useOffice();
  const { mailItem, attachments, isLoadingAttachments, getAttachmentFile } =
    useOutlookMailItem();
  const { currentThread, stagedEmails, policyExcludedAttachmentIds } =
    useOutlookEmailSource();
  const [isUploadingEmailContent, setIsUploadingEmailContent] = useState(false);
  const threadStaged = stagedEmails.find(
    (staged): staged is Extract<StagedEmail, { source: "current-thread" }> =>
      staged.source === "current-thread",
  );
  const isBusy = disabled || isProcessing || isUploadingEmailContent;
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
        : new Map(),
    [
      currentThread,
      mailItem?.internetMessageId,
      selectableAttachments,
      threadStaged,
    ],
  );

  const uploadAttachment = useCallback(
    async (attachmentId: string) => {
      if (!onSelectFiles) return;
      setIsUploadingEmailContent(true);
      try {
        const file = await getAttachmentFile(attachmentId);
        await onSelectFiles([file]);
        onClose();
      } catch (error) {
        console.warn("Failed to upload Outlook attachment:", error);
      } finally {
        setIsUploadingEmailContent(false);
      }
    },
    [getAttachmentFile, onClose, onSelectFiles],
  );

  if (!menu || host !== "Outlook") return null;
  const { thread } = menu;
  const fileName = thread.fileName;
  const hasThreadRow = thread.row !== "none";
  if (
    !hasThreadRow &&
    selectableAttachments.length === 0 &&
    !isLoadingAttachments
  ) {
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

      {hasThreadRow && (
        <Row
          variant="menu"
          align="start"
          role="menuitem"
          tabIndex={-1}
          onClick={() => {
            if (thread.row !== "add-again") return;
            thread.addAgain();
            menu.announce(
              t({
                id: "officeAddin.outlook.context.thread.announce.included",
                message: "Email thread included.",
              }),
            );
            onClose();
          }}
          disabled={isBusy || thread.row !== "add-again"}
          title={thread.fileName}
          data-testid="addin-add-menu-email-thread"
          trailing={
            thread.size !== null ? (
              <span className="shrink-0 text-xs text-theme-fg-muted">
                {formatFileSize(thread.size)}
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
              {thread.row === "add-again"
                ? t({
                    id: "officeAddin.fileSource.sentInChat",
                    message: `${fileName} · already sent in this chat; add it again`,
                  })
                : thread.row === "dropped"
                  ? t({
                      id: "officeAddin.fileSource.alreadyAdded",
                      message: "Already added",
                    })
                  : inComposerText()}
            </div>
          </div>
        </Row>
      )}

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
        // A part the policy keeps out of the thread goes nowhere.
        const isExcluded =
          !!match &&
          (policyExcludedAttachmentIds
            .get(match.messageId)
            ?.has(match.attachmentId) ??
            false);
        const isInComposer = menu.attachments === "in-composer";
        return (
          <Row
            key={attachment.id}
            variant="menu"
            align="start"
            role="menuitem"
            tabIndex={-1}
            onClick={() => void uploadAttachment(attachment.id)}
            disabled={
              isBusy ||
              uploadDisabled ||
              !onSelectFiles ||
              isCloudAttachment ||
              isExcluded ||
              isInComposer
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
                  : isExcluded
                    ? t({
                        id: "officeAddin.chatInput.validation.unsupported",
                        message: "Won't be read by the AI",
                      })
                    : isInComposer
                      ? inComposerText()
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
