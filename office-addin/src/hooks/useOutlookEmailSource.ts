import { useEffect, useMemo, useState, useCallback } from "react";

import { useOutlookMailItem } from "../providers/OutlookMailItemProvider";
import { emailToHtmlFile } from "../utils/emailToFile";

import type { LocalFilePreviewItem } from "@erato/frontend/library";

const OUTLOOK_CLOUD_ATTACHMENT_TYPE = "cloud";

export function useOutlookEmailSource() {
  const {
    itemIdentity,
    mailItem,
    attachments,
    isLoadingAttachments,
    getAttachmentFile,
  } = useOutlookMailItem();
  const [dismissedBodyMailIdentity, setDismissedBodyMailIdentity] = useState<
    string | null
  >(null);
  const [dismissedAttachmentIds, setDismissedAttachmentIds] = useState<
    string[]
  >([]);

  const emailBodyFile = useMemo(
    () => (mailItem ? emailToHtmlFile(mailItem) : null),
    [mailItem],
  );

  useEffect(() => {
    if (!itemIdentity) {
      setDismissedBodyMailIdentity(null);
      setDismissedAttachmentIds([]);
      return;
    }

    if (
      dismissedBodyMailIdentity &&
      dismissedBodyMailIdentity !== itemIdentity
    ) {
      setDismissedBodyMailIdentity(null);
      setDismissedAttachmentIds([]);
    }
  }, [dismissedBodyMailIdentity, itemIdentity]);

  const isEmailBodyIncluded =
    !!emailBodyFile &&
    !!itemIdentity &&
    dismissedBodyMailIdentity !== itemIdentity;

  const selectableAttachments = useMemo(() => {
    return attachments.filter((attachment) => !attachment.isInline);
  }, [attachments]);

  const selectedAttachmentItems = useMemo<LocalFilePreviewItem[]>(() => {
    return selectableAttachments
      .filter((attachment) => !dismissedAttachmentIds.includes(attachment.id))
      .map((attachment) => ({
        id: attachment.id,
        filename: attachment.name,
        size: attachment.size,
      }));
  }, [dismissedAttachmentIds, selectableAttachments]);

  const removeEmailBody = useCallback(() => {
    if (!itemIdentity) {
      return;
    }

    setDismissedBodyMailIdentity(itemIdentity);
  }, [itemIdentity]);

  const removeAttachment = useCallback((attachmentId: string) => {
    setDismissedAttachmentIds((previous) =>
      previous.includes(attachmentId) ? previous : [...previous, attachmentId],
    );
  }, []);

  const resolveSelectedFilesForSend = useCallback(async (): Promise<File[]> => {
    const filesToSend: File[] = [];

    if (isEmailBodyIncluded && emailBodyFile) {
      filesToSend.push(emailBodyFile);
    }

    const remainingAttachments = selectableAttachments.filter(
      (attachment) => !dismissedAttachmentIds.includes(attachment.id),
    );

    for (const attachment of remainingAttachments) {
      if (
        String(attachment.attachmentType).toLowerCase() ===
        OUTLOOK_CLOUD_ATTACHMENT_TYPE
      ) {
        console.warn(
          "Skipping Outlook cloud attachment because file content cannot be resolved locally:",
          attachment.name,
        );
        continue;
      }

      try {
        const file = await getAttachmentFile(attachment.id);
        filesToSend.push(file);
      } catch (error) {
        console.warn(
          `Failed to resolve Outlook attachment "${attachment.name}" for send:`,
          error,
        );
      }
    }

    return filesToSend;
  }, [
    dismissedAttachmentIds,
    emailBodyFile,
    getAttachmentFile,
    isEmailBodyIncluded,
    selectableAttachments,
  ]);

  return {
    emailSubject: mailItem?.subject ?? "",
    isEmailBodyIncluded,
    emailBodyFile,
    selectedAttachmentItems,
    isLoadingAttachments,
    removeEmailBody,
    removeAttachment,
    resolveSelectedFilesForSend,
    hasSelectedEmailSource:
      isEmailBodyIncluded || selectedAttachmentItems.length > 0,
  };
}
