import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { callOfficeAsync } from "../utils/officeAsync";

interface EmailAddress {
  displayName: string;
  emailAddress: string;
}

export interface OutlookAttachmentData {
  id: string;
  name: string;
  size: number;
  isInline: boolean;
  attachmentType: string;
  contentType: string;
}

export interface OutlookMailItemData {
  subject: string;
  from: EmailAddress | null;
  to: EmailAddress[];
  cc: EmailAddress[];
  dateTimeCreated: Date | null;
  conversationId: string | null;
  internetMessageId: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  isLoadingBody: boolean;
}

interface OutlookMailItemContextValue {
  itemIdentity: string | null;
  mailItem: OutlookMailItemData | null;
  attachments: OutlookAttachmentData[];
  isLoading: boolean;
  isLoadingAttachments: boolean;
  refresh: () => void;
  getAttachmentFile: (attachmentId: string) => Promise<File>;
}

const OutlookMailItemContext = createContext<OutlookMailItemContextValue>({
  itemIdentity: null,
  mailItem: null,
  attachments: [],
  isLoading: true,
  isLoadingAttachments: false,
  refresh: () => {},
  getAttachmentFile: async () => {
    throw new Error("Outlook mail item provider unavailable");
  },
});

function parseRecipients(
  recipients: Office.EmailAddressDetails[] | undefined,
): EmailAddress[] {
  if (!recipients) {
    return [];
  }

  return recipients.map((recipient) => ({
    displayName: recipient.displayName,
    emailAddress: recipient.emailAddress,
  }));
}

function isMessageRead(
  item: Office.MessageRead | Office.MessageCompose,
): item is Office.MessageRead {
  return typeof (item as Office.MessageRead).subject === "string";
}

function buildMailItemIdentity(
  item: Office.MessageRead | Office.MessageCompose | null,
): string | null {
  if (!item) {
    return null;
  }

  if (isMessageRead(item)) {
    return (
      item.internetMessageId ??
      item.conversationId ??
      `${item.subject ?? ""}:${item.dateTimeCreated?.toISOString() ?? "no-date"}`
    );
  }

  return (
    item.conversationId ??
    `compose:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`
  );
}

function parseAttachmentDetails(
  attachment: Office.AttachmentDetails | Office.AttachmentDetailsCompose,
): OutlookAttachmentData {
  return {
    id: attachment.id,
    name: attachment.name,
    size: attachment.size,
    isInline: attachment.isInline,
    attachmentType: String(attachment.attachmentType),
    contentType:
      "contentType" in attachment && typeof attachment.contentType === "string"
        ? attachment.contentType
        : "",
  };
}

async function readAttachmentMetadata(
  item: Office.MessageRead | Office.MessageCompose,
): Promise<OutlookAttachmentData[]> {
  if (isMessageRead(item)) {
    return item.attachments.map(parseAttachmentDetails);
  }

  const attachments = await callOfficeAsync<Office.AttachmentDetailsCompose[]>(
    (callback) => item.getAttachmentsAsync(callback),
  );
  return attachments.map(parseAttachmentDetails);
}

function base64ToArrayBuffer(content: string): ArrayBuffer {
  const binaryString = window.atob(content);
  const bytes = new Uint8Array(binaryString.length);

  for (let index = 0; index < binaryString.length; index += 1) {
    bytes[index] = binaryString.charCodeAt(index);
  }

  return bytes.buffer;
}

function inferAttachmentMimeType(
  attachment: OutlookAttachmentData | undefined,
  format: string,
): string {
  if (attachment?.contentType) {
    return attachment.contentType;
  }

  switch (format) {
    case Office.MailboxEnums.AttachmentContentFormat.Eml:
      return "message/rfc822";
    case Office.MailboxEnums.AttachmentContentFormat.ICalendar:
      return "text/calendar";
    default:
      return "application/octet-stream";
  }
}

function attachmentContentToFile(
  attachmentContent: Office.AttachmentContent,
  attachment: OutlookAttachmentData,
): File {
  switch (attachmentContent.format) {
    case Office.MailboxEnums.AttachmentContentFormat.Base64:
      return new File(
        [base64ToArrayBuffer(attachmentContent.content)],
        attachment.name,
        {
          type: inferAttachmentMimeType(attachment, attachmentContent.format),
        },
      );
    case Office.MailboxEnums.AttachmentContentFormat.Eml:
    case Office.MailboxEnums.AttachmentContentFormat.ICalendar:
      return new File([attachmentContent.content], attachment.name, {
        type: inferAttachmentMimeType(attachment, attachmentContent.format),
      });
    case Office.MailboxEnums.AttachmentContentFormat.Url:
      throw new Error(
        `Cloud attachments are not supported for upload: ${attachment.name}`,
      );
    default:
      throw new Error(
        `Unsupported attachment content format: ${attachmentContent.format}`,
      );
  }
}

function readMailItemSync(item: Office.MessageRead): OutlookMailItemData {
  const from = item.from
    ? {
        displayName: item.from.displayName,
        emailAddress: item.from.emailAddress,
      }
    : null;

  return {
    subject: item.subject ?? "",
    from,
    to: parseRecipients(item.to),
    cc: parseRecipients(item.cc),
    dateTimeCreated: item.dateTimeCreated ?? null,
    conversationId: item.conversationId ?? null,
    internetMessageId: item.internetMessageId ?? null,
    bodyText: null,
    bodyHtml: null,
    isLoadingBody: true,
  };
}

function readMailItemCompose(
  item: Office.MessageCompose,
  setMailItem: React.Dispatch<React.SetStateAction<OutlookMailItemData | null>>,
  canCommit: () => boolean,
) {
  setMailItem({
    subject: "",
    from: null,
    to: [],
    cc: [],
    dateTimeCreated: null,
    conversationId: item.conversationId ?? null,
    internetMessageId: null,
    bodyText: null,
    bodyHtml: null,
    isLoadingBody: true,
  });

  item.subject.getAsync((result) => {
    if (result.status === Office.AsyncResultStatus.Succeeded && canCommit()) {
      setMailItem((previous) =>
        previous ? { ...previous, subject: result.value } : previous,
      );
    }
  });

  item.to.getAsync((result) => {
    if (result.status === Office.AsyncResultStatus.Succeeded && canCommit()) {
      setMailItem((previous) =>
        previous
          ? { ...previous, to: parseRecipients(result.value) }
          : previous,
      );
    }
  });

  item.cc.getAsync((result) => {
    if (result.status === Office.AsyncResultStatus.Succeeded && canCommit()) {
      setMailItem((previous) =>
        previous
          ? { ...previous, cc: parseRecipients(result.value) }
          : previous,
      );
    }
  });

  let textDone = false;
  let htmlDone = false;

  const checkDone = () => {
    if (textDone && htmlDone && canCommit()) {
      setMailItem((previous) =>
        previous ? { ...previous, isLoadingBody: false } : previous,
      );
    }
  };

  item.body.getAsync(Office.CoercionType.Text, (result) => {
    if (result.status === Office.AsyncResultStatus.Succeeded && canCommit()) {
      setMailItem((previous) =>
        previous ? { ...previous, bodyText: result.value } : previous,
      );
    }

    textDone = true;
    checkDone();
  });

  item.body.getAsync(Office.CoercionType.Html, (result) => {
    if (result.status === Office.AsyncResultStatus.Succeeded && canCommit()) {
      setMailItem((previous) =>
        previous ? { ...previous, bodyHtml: result.value } : previous,
      );
    }

    htmlDone = true;
    checkDone();
  });
}

export function useOutlookMailItem() {
  return useContext(OutlookMailItemContext);
}

export function OutlookMailItemProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [itemIdentity, setItemIdentity] = useState<string | null>(null);
  const [mailItem, setMailItem] = useState<OutlookMailItemData | null>(null);
  const [attachments, setAttachments] = useState<OutlookAttachmentData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingAttachments, setIsLoadingAttachments] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const currentItemRef = useRef<
    Office.MessageRead | Office.MessageCompose | null
  >(null);
  const selectionVersionRef = useRef(0);

  const refresh = useCallback(() => {
    setRefreshKey((previous) => previous + 1);
  }, []);

  const getAttachmentFile = useCallback(
    async (attachmentId: string): Promise<File> => {
      const currentItem = currentItemRef.current;
      if (!currentItem) {
        throw new Error("No Outlook item is currently selected");
      }

      const currentAttachment = attachments.find(
        (attachment) => attachment.id === attachmentId,
      );
      if (!currentAttachment) {
        throw new Error(`Attachment not found: ${attachmentId}`);
      }

      const attachmentContent = await callOfficeAsync<Office.AttachmentContent>(
        (callback) =>
          currentItem.getAttachmentContentAsync(attachmentId, callback),
      );

      return attachmentContentToFile(attachmentContent, currentAttachment);
    },
    [attachments],
  );

  useEffect(() => {
    const item = Office.context.mailbox.item as
      | Office.MessageRead
      | Office.MessageCompose
      | null;
    const selectionVersion = selectionVersionRef.current + 1;
    selectionVersionRef.current = selectionVersion;
    currentItemRef.current = item;
    const canCommit = () => selectionVersionRef.current === selectionVersion;
    const nextItemIdentity = buildMailItemIdentity(item);
    setItemIdentity(nextItemIdentity);

    if (!item) {
      setMailItem(null);
      setAttachments([]);
      setIsLoading(false);
      setIsLoadingAttachments(false);
      return;
    }

    setAttachments([]);
    setIsLoadingAttachments(true);
    void readAttachmentMetadata(item)
      .then((nextAttachments) => {
        if (!canCommit()) {
          return;
        }
        setAttachments(nextAttachments);
      })
      .catch((error) => {
        if (!canCommit()) {
          return;
        }
        console.warn("Failed to read Outlook attachments:", error);
        setAttachments([]);
      })
      .finally(() => {
        if (!canCommit()) {
          return;
        }
        setIsLoadingAttachments(false);
      });

    if (isMessageRead(item)) {
      setMailItem(readMailItemSync(item));
      setIsLoading(false);

      let textDone = false;
      let htmlDone = false;

      const checkDone = () => {
        if (textDone && htmlDone && canCommit()) {
          setMailItem((previous) =>
            previous ? { ...previous, isLoadingBody: false } : previous,
          );
        }
      };

      item.body.getAsync(Office.CoercionType.Text, (result) => {
        if (
          result.status === Office.AsyncResultStatus.Succeeded &&
          canCommit()
        ) {
          setMailItem((previous) =>
            previous ? { ...previous, bodyText: result.value } : previous,
          );
        } else if (canCommit()) {
          console.warn("Failed to read email body:", result.error?.message);
        }

        textDone = true;
        checkDone();
      });

      item.body.getAsync(Office.CoercionType.Html, (result) => {
        if (
          result.status === Office.AsyncResultStatus.Succeeded &&
          canCommit()
        ) {
          setMailItem((previous) =>
            previous ? { ...previous, bodyHtml: result.value } : previous,
          );
        } else if (canCommit()) {
          console.warn(
            "Failed to read email HTML body:",
            result.error?.message,
          );
        }

        htmlDone = true;
        checkDone();
      });
    } else {
      readMailItemCompose(item, setMailItem, canCommit);
      setIsLoading(false);
    }
  }, [refreshKey]);

  useEffect(() => {
    const mailbox = Office.context.mailbox;

    function onItemChanged() {
      setRefreshKey((previous) => previous + 1);
    }

    try {
      mailbox.addHandlerAsync(
        Office.EventType.ItemChanged,
        onItemChanged,
        (result) => {
          if (result.status !== Office.AsyncResultStatus.Succeeded) {
            console.warn(
              "Failed to register ItemChanged handler:",
              result.error?.message,
            );
          }
        },
      );
    } catch (error) {
      console.warn("ItemChanged not supported:", error);
    }

    return () => {
      try {
        mailbox.removeHandlerAsync(Office.EventType.ItemChanged, () => {});
      } catch {
        // Best-effort cleanup.
      }
    };
  }, []);

  return (
    <OutlookMailItemContext.Provider
      value={{
        itemIdentity,
        mailItem,
        attachments,
        isLoading,
        isLoadingAttachments,
        refresh,
        getAttachmentFile,
      }}
    >
      {children}
    </OutlookMailItemContext.Provider>
  );
}
