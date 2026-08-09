import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { callOfficeAsync } from "../../utils/officeAsync";
import {
  UNSAVED_APPOINTMENT_IDENTITY_PREFIX,
  UNSAVED_COMPOSE_IDENTITY_PREFIX,
  getOrMintItemIdentity,
  isAppointmentCompose,
  isMessageRead,
  resolveSupportedMailboxItem,
  type SupportedOutlookItem,
} from "../sessionPolicy";

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
  itemKind: "message" | "appointment";
  subject: string;
  from: EmailAddress | null;
  to: EmailAddress[];
  cc: EmailAddress[];
  organizer: EmailAddress | null;
  requiredAttendees: EmailAddress[];
  optionalAttendees: EmailAddress[];
  location: string;
  start: Date | null;
  end: Date | null;
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
  // True once the resolved item has actually CHANGED to a different one — a
  // real navigation, which only a pinned/tracking pane observes. The host's
  // initial same-item selection event does NOT count (it would otherwise clear
  // the hint the instant the first message loads). On new Outlook for Mac an
  // unpinned pane never sees a real change, so this stays false. Drives the
  // "pin this add-in" hint's self-clear.
  hasItemChangedFired: boolean;
  refresh: () => void;
  getAttachmentFile: (attachmentId: string) => Promise<File>;
}

const OutlookMailItemContext = createContext<OutlookMailItemContextValue>({
  itemIdentity: null,
  mailItem: null,
  attachments: [],
  isLoading: true,
  isLoadingAttachments: false,
  hasItemChangedFired: false,
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

/**
 * Sentinel send-time identity for a send with NO Outlook item open (neutral
 * context: pinned pane with nothing selected). A REAL captured value — not a
 * capture failure — so completions from neutral sends still count as fresh
 * and item-INDEPENDENT actions (create appointment) can auto-prompt there.
 * Item-BOUND executors (reply) treat it like any mismatching identity and
 * fail closed. Distinct by construction from every built identity (message
 * ids, `subject:date`, `compose:` mints).
 */
export const NO_ITEM_SEND_IDENTITY = "no-item";

function buildMailItemIdentity(
  item: SupportedOutlookItem | null,
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

  if (isAppointmentCompose(item)) {
    // Never `seriesId` — it names the whole recurring series, so every
    // occurrence would share an identity (and the insert gate would allow
    // cross-occurrence inserts). Must agree with `outlookAnchorFromItem`.
    return getOrMintItemIdentity(item, UNSAVED_APPOINTMENT_IDENTITY_PREFIX);
  }

  return (
    item.conversationId ??
    `${UNSAVED_COMPOSE_IDENTITY_PREFIX}${globalThis.crypto.randomUUID()}`
  );
}

// Minted fallbacks differ on every resolve of the SAME unsaved draft (a host
// may hand out a fresh item object at any time), so comparing two of them
// can't prove a navigation happened.
function isStableItemIdentity(identity: string | null): identity is string {
  return (
    identity !== null &&
    !identity.startsWith(UNSAVED_COMPOSE_IDENTITY_PREFIX) &&
    !identity.startsWith(UNSAVED_APPOINTMENT_IDENTITY_PREFIX)
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
    itemKind: "message",
    subject: item.subject ?? "",
    from,
    to: parseRecipients(item.to),
    cc: parseRecipients(item.cc),
    organizer: null,
    requiredAttendees: [],
    optionalAttendees: [],
    location: "",
    start: null,
    end: null,
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
    itemKind: "message",
    subject: "",
    from: null,
    to: [],
    cc: [],
    organizer: null,
    requiredAttendees: [],
    optionalAttendees: [],
    location: "",
    start: null,
    end: null,
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

/**
 * Every appointment-compose field the add-in uses, read in one awaitable
 * sweep. Editing an appointment form fires no ItemChanged, so any state
 * captured at bind time goes stale — the send path re-reads a fresh snapshot
 * of the live item instead of trusting provider state.
 */
export interface AppointmentComposeSnapshot {
  subject: string;
  organizer: EmailAddress | null;
  requiredAttendees: EmailAddress[];
  optionalAttendees: EmailAddress[];
  location: string;
  start: Date | null;
  end: Date | null;
  bodyText: string | null;
  bodyHtml: string | null;
}

export const EMPTY_APPOINTMENT_SNAPSHOT: AppointmentComposeSnapshot = {
  subject: "",
  organizer: null,
  requiredAttendees: [],
  optionalAttendees: [],
  location: "",
  start: null,
  end: null,
  bodyText: null,
  bodyHtml: null,
};

// Bounds each property read so a wedged host (classic Win32 was seen dropping
// callbacks entirely, ERMAIN-431) degrades to the fallback value instead of
// hanging the caller — at send time that would hold the user's message.
const APPOINTMENT_READ_TIMEOUT_MS = 5_000;

function readOptionalProperty<TRaw, TValue>(
  property:
    | {
        getAsync?: (
          callback: (result: Office.AsyncResult<TRaw>) => void,
        ) => void;
      }
    | undefined,
  map: (value: TRaw) => TValue,
  fallback: TValue,
): Promise<TValue> {
  if (typeof property?.getAsync !== "function") {
    return Promise.resolve(fallback);
  }
  return callOfficeAsync<TRaw>((callback) => property.getAsync!(callback), {
    timeoutMs: APPOINTMENT_READ_TIMEOUT_MS,
  })
    .then(map)
    .catch(() => fallback);
}

/**
 * Read a fresh snapshot of an appointment compose item. Individual reads that
 * fail, time out, or aren't supported by the host resolve to the matching
 * `fallback` field, so the result is always complete and the promise never
 * rejects.
 */
export async function readAppointmentComposeSnapshot(
  item: Office.AppointmentCompose,
  fallback: AppointmentComposeSnapshot = EMPTY_APPOINTMENT_SNAPSHOT,
): Promise<AppointmentComposeSnapshot> {
  const readBody = (
    coercionType: Office.CoercionType,
    bodyFallback: string | null,
  ): Promise<string | null> =>
    callOfficeAsync<string>(
      (callback) => item.body.getAsync(coercionType, callback),
      { timeoutMs: APPOINTMENT_READ_TIMEOUT_MS },
    ).catch(() => bodyFallback);

  const [
    subject,
    organizer,
    requiredAttendees,
    optionalAttendees,
    location,
    start,
    end,
    bodyText,
    bodyHtml,
  ] = await Promise.all([
    readOptionalProperty(
      item.subject,
      (value: string) => value,
      fallback.subject,
    ),
    readOptionalProperty(
      item.organizer,
      (details: Office.EmailAddressDetails): EmailAddress | null =>
        details
          ? {
              displayName: details.displayName,
              emailAddress: details.emailAddress,
            }
          : null,
      fallback.organizer,
    ),
    readOptionalProperty(
      item.requiredAttendees,
      parseRecipients,
      fallback.requiredAttendees,
    ),
    readOptionalProperty(
      item.optionalAttendees,
      parseRecipients,
      fallback.optionalAttendees,
    ),
    readOptionalProperty(
      item.location,
      (value: string) => value,
      fallback.location,
    ),
    readOptionalProperty(item.start, (value: Date) => value, fallback.start),
    readOptionalProperty(item.end, (value: Date) => value, fallback.end),
    readBody(Office.CoercionType.Text, fallback.bodyText),
    readBody(Office.CoercionType.Html, fallback.bodyHtml),
  ]);

  return {
    subject,
    organizer,
    requiredAttendees,
    optionalAttendees,
    location,
    start,
    end,
    bodyText,
    bodyHtml,
  };
}

function readAppointmentCompose(
  item: Office.AppointmentCompose,
  setMailItem: React.Dispatch<React.SetStateAction<OutlookMailItemData | null>>,
  canCommit: () => boolean,
) {
  setMailItem({
    itemKind: "appointment",
    subject: "",
    from: null,
    to: [],
    cc: [],
    organizer: null,
    requiredAttendees: [],
    optionalAttendees: [],
    location: "",
    start: null,
    end: null,
    dateTimeCreated: null,
    conversationId: null,
    internetMessageId: null,
    itemId: null,
    bodyText: null,
    bodyHtml: null,
    isLoadingBody: true,
    isComposeMode: true,
  });

  void readAppointmentComposeSnapshot(item).then((snapshot) => {
    if (!canCommit()) return;
    setMailItem((previous) =>
      previous ? { ...previous, ...snapshot, isLoadingBody: false } : previous,
    );
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
  const [hasItemChangedFired, setHasItemChangedFired] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const currentItemRef = useRef<SupportedOutlookItem | null>(null);
  const selectionVersionRef = useRef(0);
  // Identity of the last resolved item — lets us tell a real navigation (the
  // pin-hint tracking signal) from the host's initial same-item selection
  // event.
  const lastItemIdentityRef = useRef<string | null>(null);

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
    // Organizer appointment compose is a first-class surface. Appointment
    // attendee/read items still resolve to neutral context and fail closed.
    const item = resolveSupportedMailboxItem(Office.context.mailbox.item);
    const selectionVersion = selectionVersionRef.current + 1;
    selectionVersionRef.current = selectionVersion;
    currentItemRef.current = item;
    const canCommit = () => selectionVersionRef.current === selectionVersion;
    const nextItemIdentity = buildMailItemIdentity(item);
    const previousItemIdentity = lastItemIdentityRef.current;
    if (nextItemIdentity !== null) {
      // Keep the last real identity across null-item events (pinned panes
      // receive ItemChanged with item == null on deselect), so A → null → B
      // still registers as a navigation.
      lastItemIdentityRef.current = nextItemIdentity;
    }
    setItemIdentity(nextItemIdentity);
    // The pane is effectively pinned/tracking only once the selected item
    // actually changes to a *different* one (a real navigation). The host also
    // fires a selection event on the initial bind with the SAME item — that
    // must not count, or the pin hint clears the instant the first message
    // loads and is never seen. See ERMAIN-411.
    if (
      isStableItemIdentity(previousItemIdentity) &&
      isStableItemIdentity(nextItemIdentity) &&
      nextItemIdentity !== previousItemIdentity
    ) {
      setHasItemChangedFired(true);
    }

    if (!item) {
      setMailItem(null);
      setAttachments([]);
      setIsLoading(false);
      setIsLoadingAttachments(false);
      return;
    }

    setAttachments([]);
    if (isAppointmentCompose(item)) {
      // Appointment attachments must never surface as email context — the
      // '+' menu and the email-source provider both read this state, so the
      // isolation has to hold at the source.
      setIsLoadingAttachments(false);
      readAppointmentCompose(item, setMailItem, canCommit);
      setIsLoading(false);
      return;
    }
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
          // Mailbox.removeHandlerAsync removes ALL handlers for the event
          // type; its optional second arg is a completion callback, not a
          // handler filter — passing a handler there gets it invoked.
          mailbox.removeHandlerAsync(eventType);
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
        hasItemChangedFired,
        refresh,
        getAttachmentFile,
      }}
    >
      {children}
    </OutlookMailItemContext.Provider>
  );
}
