import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { isMessageRead } from "../sessionPolicy";
import { callOfficeAsync } from "../utils/officeAsync";

// Settling window before a previously-open READ message whose Office item
// silently went undefined (office-js #5575 on new Outlook for Mac: opening the
// inline new-mail editor leaves the pinned read pane bound to no item, yet
// `ItemChanged` fires) is surfaced as a lost-context recovery state. Sized to
// outlast the normal read→reply / inline-compose item null-flap (mirrors
// `useOutlookComposeSelection`'s NULL_GRACE_MS) so ordinary transitions never
// trip the banner. See ERMAIN-411.
const DEAD_STATE_SETTLE_MS = 2500;

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
  // EWS item id for read-mode messages. Null for compose mode (no Graph-
  // reachable id until the draft is saved) — callers gate Graph fetches on
  // this being present.
  itemId: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  isLoadingBody: boolean;
  // True when the underlying Office item is a `MessageCompose` (the user is
  // drafting). False for `MessageRead` (the user is reading an email). Used
  // by the action-facet wrapper to gate `outlook_review_draft`, which only
  // makes sense for the user's own draft — never for received mail.
  isComposeMode: boolean;
}

interface OutlookMailItemContextValue {
  itemIdentity: string | null;
  mailItem: OutlookMailItemData | null;
  attachments: OutlookAttachmentData[];
  isLoading: boolean;
  isLoadingAttachments: boolean;
  // True only when a previously-open READ message's Office item silently went
  // undefined and stayed gone past `DEAD_STATE_SETTLE_MS` (the office-js #5575
  // dead state). Distinct from the legitimate no-item state (cold-open / no
  // message selected), which never sets this. Consumers surface a dismissible
  // recovery affordance; the chat itself stays usable.
  itemContextLost: boolean;
  refresh: () => void;
  getAttachmentFile: (attachmentId: string) => Promise<File>;
}

const OutlookMailItemContext = createContext<OutlookMailItemContextValue>({
  itemIdentity: null,
  mailItem: null,
  attachments: [],
  isLoading: true,
  isLoadingAttachments: false,
  itemContextLost: false,
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
    itemId: item.itemId ?? null,
    bodyText: null,
    bodyHtml: null,
    isLoadingBody: true,
    isComposeMode: false,
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
    itemId: null,
    bodyText: null,
    bodyHtml: null,
    isLoadingBody: true,
    isComposeMode: true,
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
  const [itemContextLost, setItemContextLost] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const currentItemRef = useRef<
    Office.MessageRead | Office.MessageCompose | null
  >(null);
  // The most recent non-null READ item. Persists across falsy reads (unlike
  // `currentItemRef`, which is nulled on every falsy item), so a #5575 drop can
  // be told apart from a cold-open: only a falsy read that *follows* a real
  // read item arms recovery. Cleared when a compose item loads, so the
  // reply/inline-compose null-flap is never mistaken for the dead state.
  const lastReadItemRef = useRef<Office.MessageRead | null>(null);
  // Pending dead-state settle timer (see `DEAD_STATE_SETTLE_MS`). Ref-stored so
  // it can be cancelled when a new selection supersedes it or on unmount.
  const deadStateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    // Cancel any in-flight dead-state settle from a prior selection; the
    // branches below re-arm it only if this selection is itself a dead state.
    if (deadStateTimerRef.current !== null) {
      clearTimeout(deadStateTimerRef.current);
      deadStateTimerRef.current = null;
    }

    const item = Office.context.mailbox.item as
      | Office.MessageRead
      | Office.MessageCompose
      | null;
    const selectionVersion = selectionVersionRef.current + 1;
    selectionVersionRef.current = selectionVersion;
    // The last READ item observed *before* this run — the truthy branch below
    // is the only writer of `lastReadItemRef`, so in the falsy branch it still
    // holds the prior value.
    const hadReadItem = lastReadItemRef.current !== null;
    currentItemRef.current = item;
    const canCommit = () => selectionVersionRef.current === selectionVersion;
    const nextItemIdentity = buildMailItemIdentity(item);
    setItemIdentity(nextItemIdentity);

    if (!item) {
      setMailItem(null);
      setAttachments([]);
      setIsLoading(false);
      setIsLoadingAttachments(false);

      // Disambiguate the office-js #5575 dead state from the legitimate
      // contextless state. Only a falsy read that follows a real READ item
      // arms recovery; cold-open / no-message-selected (no prior read item)
      // and the compose null-flap (a compose item clears `lastReadItemRef`)
      // keep today's silent behavior. The settle timer re-reads the live
      // Office item when it fires: a still-falsy item surfaces the recovery
      // banner, while an item that quietly came back is loaded instead.
      if (hadReadItem) {
        deadStateTimerRef.current = setTimeout(() => {
          deadStateTimerRef.current = null;
          const live = Office.context.mailbox.item as
            | Office.MessageRead
            | Office.MessageCompose
            | null;
          if (live) {
            setItemContextLost(false);
            setRefreshKey((previous) => previous + 1);
          } else {
            setItemContextLost(true);
          }
        }, DEAD_STATE_SETTLE_MS);
      } else {
        setItemContextLost(false);
      }
      return;
    }

    // A real item is in context: clear any recovery state and remember the
    // last READ item so a later silent #5575 drop can be told apart from a
    // cold-open. Compose items clear it (their null-flap is handled elsewhere).
    setItemContextLost(false);
    lastReadItemRef.current = isMessageRead(item) ? item : null;

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

  // Cancel a pending dead-state settle on unmount so its callback can't fire
  // after teardown (the timer also survives React StrictMode's mount/unmount/
  // mount probe, where this cleanup clears the first mount's timer).
  useEffect(() => {
    return () => {
      if (deadStateTimerRef.current !== null) {
        clearTimeout(deadStateTimerRef.current);
        deadStateTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const mailbox = Office.context.mailbox;

    function onSelectionChanged() {
      setRefreshKey((previous) => previous + 1);
    }

    // OWA and New Outlook drop `ItemChanged` for in-thread navigation
    // (selecting between replies in the same conversation), so layer in
    // `SelectedItemsChanged` (Mailbox 1.13+) as a redundant signal. Both
    // funnel through the same refresh; the read effect's `selectionVersion`
    // ref discards stale callbacks if both fire for the same change.
    function subscribe(eventType: Office.EventType, label: string) {
      try {
        mailbox.addHandlerAsync(eventType, onSelectionChanged, (result) => {
          if (result.status !== Office.AsyncResultStatus.Succeeded) {
            console.warn(
              `Failed to register ${label} handler:`,
              result.error?.message,
            );
          }
        });
      } catch (error) {
        console.warn(`${label} not supported:`, error);
      }
    }

    subscribe(Office.EventType.ItemChanged, "ItemChanged");
    if (Office.EventType.SelectedItemsChanged !== undefined) {
      subscribe(Office.EventType.SelectedItemsChanged, "SelectedItemsChanged");
    }

    return () => {
      function unsubscribe(eventType: Office.EventType) {
        try {
          // Pass the registered handler so Office removes exactly this
          // subscription. A throwaway closure here removes nothing, leaking the
          // handler across React StrictMode's mount/unmount/mount probe.
          mailbox.removeHandlerAsync(eventType, onSelectionChanged);
        } catch {
          // Best-effort cleanup.
        }
      }
      unsubscribe(Office.EventType.ItemChanged);
      if (Office.EventType.SelectedItemsChanged !== undefined) {
        unsubscribe(Office.EventType.SelectedItemsChanged);
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
        itemContextLost,
        refresh,
        getAttachmentFile,
      }}
    >
      {children}
    </OutlookMailItemContext.Provider>
  );
}
