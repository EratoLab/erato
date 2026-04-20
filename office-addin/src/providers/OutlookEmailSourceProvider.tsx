import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { useOutlookMailItem } from "./OutlookMailItemProvider";
import { emailToHtmlFile } from "../utils/emailToFile";

import type { LocalFilePreviewItem } from "@erato/frontend/library";
import type { ReactNode } from "react";

const OUTLOOK_CLOUD_ATTACHMENT_TYPE = "cloud";

interface OutlookEmailSourceContextValue {
  emailSubject: string;
  isEmailBodyIncluded: boolean;
  emailBodyFile: File | null;
  selectedAttachmentItems: LocalFilePreviewItem[];
  isLoadingAttachments: boolean;
  removeEmailBody: () => void;
  removeAttachment: (attachmentId: string) => void;
  restoreEmailBody: () => void;
  restoreAttachment: (attachmentId: string) => void;
  isEmailBodyDismissed: boolean;
  dismissedAttachmentIds: string[];
  resolveSelectedFilesForSend: () => Promise<File[]>;
  hasSelectedEmailSource: boolean;
}

const defaultValue: OutlookEmailSourceContextValue = {
  emailSubject: "",
  isEmailBodyIncluded: false,
  emailBodyFile: null,
  selectedAttachmentItems: [],
  isLoadingAttachments: false,
  removeEmailBody: () => {},
  removeAttachment: () => {},
  restoreEmailBody: () => {},
  restoreAttachment: () => {},
  isEmailBodyDismissed: false,
  dismissedAttachmentIds: [],
  resolveSelectedFilesForSend: async () => [],
  hasSelectedEmailSource: false,
};

const OutlookEmailSourceContext =
  createContext<OutlookEmailSourceContextValue>(defaultValue);

export function useOutlookEmailSource(): OutlookEmailSourceContextValue {
  return useContext(OutlookEmailSourceContext);
}

export function OutlookEmailSourceProvider({
  children,
}: {
  children: ReactNode;
}) {
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

  const isEmailBodyDismissed =
    !!itemIdentity && dismissedBodyMailIdentity === itemIdentity;

  const isEmailBodyIncluded = !!emailBodyFile && !isEmailBodyDismissed;

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

  const restoreEmailBody = useCallback(() => {
    setDismissedBodyMailIdentity(null);
  }, []);

  const restoreAttachment = useCallback((attachmentId: string) => {
    setDismissedAttachmentIds((previous) =>
      previous.filter((id) => id !== attachmentId),
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

  const value = useMemo<OutlookEmailSourceContextValue>(
    () => ({
      emailSubject: mailItem?.subject ?? "",
      isEmailBodyIncluded,
      emailBodyFile,
      selectedAttachmentItems,
      isLoadingAttachments,
      removeEmailBody,
      removeAttachment,
      restoreEmailBody,
      restoreAttachment,
      isEmailBodyDismissed,
      dismissedAttachmentIds,
      resolveSelectedFilesForSend,
      hasSelectedEmailSource:
        isEmailBodyIncluded || selectedAttachmentItems.length > 0,
    }),
    [
      dismissedAttachmentIds,
      emailBodyFile,
      isEmailBodyDismissed,
      isEmailBodyIncluded,
      isLoadingAttachments,
      mailItem?.subject,
      removeAttachment,
      removeEmailBody,
      resolveSelectedFilesForSend,
      restoreAttachment,
      restoreEmailBody,
      selectedAttachmentItems,
    ],
  );

  return (
    <OutlookEmailSourceContext.Provider value={value}>
      {children}
    </OutlookEmailSourceContext.Provider>
  );
}
