import { callOfficeAsync } from "./officeAsync";
import { sanitizeReplyFormHtml } from "./sanitizeReplyFormHtml";
import {
  isMessageRead,
  resolveSupportedMailboxItem,
} from "../sessionPolicy/outlookAnchor";

import type { OutlookEmailClientAction } from "./outlookClientActions";

/**
 * Office.js rejects reply form bodies above 32 KB (displayReplyForm /
 * displayReplyFormAsync throw on oversized string parameters).
 */
export const REPLY_FORM_BODY_LIMIT_BYTES = 32 * 1024;

/** Thrown when the draft can't be prefilled; the UI falls back to Copy. */
export class ReplyBodyTooLargeError extends Error {
  constructor() {
    super("Reply draft exceeds the Office.js reply form body limit");
    this.name = "ReplyBodyTooLargeError";
  }
}

/**
 * Escape model-produced plain text for use in a reply form body. The form
 * data parameter is interpreted as HTML, so raw text must be escaped and
 * newlines converted to keep the draft's line structure.
 */
export function escapeTextAsHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\r\n|\r|\n/g, "<br>");
}

/**
 * Build the HTML body passed to the reply form: outbound-grade sanitization
 * for model-produced HTML fragments (stricter than the in-chat preview — the
 * output becomes the user's draft), entity-escaping for plain text.
 */
export function buildReplyFormBody(content: string, isHtml: boolean): string {
  return isHtml ? sanitizeReplyFormHtml(content) : escapeTextAsHtml(content);
}

export function isReplyFormBodyTooLarge(body: string): boolean {
  return new TextEncoder().encode(body).length > REPLY_FORM_BODY_LIMIT_BYTES;
}

function getReadModeItem(): Office.MessageRead | null {
  // Appointments fail closed via the shared guard — a "reply" on an
  // AppointmentRead would open a meeting reply form.
  const item = resolveSupportedMailboxItem(Office.context?.mailbox?.item);
  if (!item || !isMessageRead(item)) {
    return null;
  }
  return item;
}

/**
 * Whether the host supports the reply form APIs at all (Mailbox 1.1; not
 * available on Outlook mobile). Host-static for the session — does NOT read the
 * live `Office.context.mailbox.item`, so it is safe to call from a render path
 * without going stale as the open item changes. Pair it with the REACTIVE
 * read-item signal (`isReadMode`, from OutlookMailItemProvider) to decide
 * whether to OFFER reply actions; use `isReadReplySupported()` /
 * `getReadModeItem()` to GUARD execution against the live item.
 */
export function isReplyFormHostSupported(): boolean {
  return (
    Office.context.requirements?.isSetSupported?.("Mailbox", "1.1") ?? false
  );
}

/**
 * Whether the current Office context can open a reply form right now: a
 * read-mode message is open and the host supports the reply form APIs. Reads
 * the LIVE item, so use this to GUARD execution (e.g. `openReplyForm`), never
 * to gate render — a render gate must track the reactive item state via
 * `isReadMode` + `isReplyFormHostSupported`, or it caches stale results.
 */
export function isReadReplySupported(): boolean {
  if (!getReadModeItem()) {
    return false;
  }
  return isReplyFormHostSupported();
}

export interface ReadModeRecipientSummary {
  /** Formatted sender entry — the target of a plain reply. */
  sender: string | null;
  /**
   * Formatted To + Cc entries of the message being read, deduplicated by
   * address and excluding the reading user and the sender (the reply form
   * never re-addresses the user, and the sender is already listed above).
   */
  recipients: string[];
}

/**
 * Display names are sender-controlled: one could spoof another address or
 * fake extra entries via commas. The SMTP address is therefore always part
 * of the entry, never replaced by the display name.
 */
function formatRecipientEntry(details: Office.EmailAddressDetails): string {
  const name = details.displayName?.trim();
  return name && name.toLowerCase() !== details.emailAddress.toLowerCase()
    ? `${name} <${details.emailAddress}>`
    : details.emailAddress;
}

/**
 * Re-read the recipients of the CURRENT read-mode item at confirmation time.
 * Outlook itself derives the actual reply-all recipient set when the form
 * opens; this summary exists so the user confirms against fresh data, not
 * against whatever the chat message was generated from. Every listed entry
 * counts: the confirmation copy's recipient count is the number of entries
 * shown.
 */
export function getReadModeRecipientSummary(): ReadModeRecipientSummary | null {
  const item = getReadModeItem();
  if (!item) {
    return null;
  }
  const ownAddress =
    Office.context.mailbox.userProfile?.emailAddress?.toLowerCase() ?? null;
  const senderAddress = item.from?.emailAddress.toLowerCase() ?? null;
  const seen = new Set<string>();
  const recipients = [...(item.to ?? []), ...(item.cc ?? [])]
    .filter((details) => {
      const address = details.emailAddress.toLowerCase();
      if (
        address === ownAddress ||
        address === senderAddress ||
        seen.has(address)
      ) {
        return false;
      }
      seen.add(address);
      return true;
    })
    .map(formatRecipientEntry);
  return {
    sender: item.from ? formatRecipientEntry(item.from) : null,
    recipients,
  };
}

/**
 * Open Outlook's native reply / reply-all form prefilled with the draft.
 * This never sends anything — the user reviews and sends (or discards) the
 * draft in Outlook's own compose window.
 *
 * Throws when the current item is not a read-mode message (e.g. the user
 * switched to a compose window since the draft was generated) or when the
 * body exceeds the Office.js limit.
 */
export async function openReplyForm(
  action: OutlookEmailClientAction,
  content: string,
  isHtml: boolean,
): Promise<void> {
  const item = getReadModeItem();
  if (!item) {
    throw new Error("The current Outlook item is not an open received email.");
  }
  const body = buildReplyFormBody(content, isHtml);
  if (isReplyFormBodyTooLarge(body)) {
    throw new ReplyBodyTooLargeError();
  }
  const supportsAsync =
    Office.context.requirements?.isSetSupported?.("Mailbox", "1.9") ?? false;
  if (action === "outlook.reply_all") {
    if (supportsAsync) {
      await callOfficeAsync<void>((callback) =>
        item.displayReplyAllFormAsync(body, callback),
      );
    } else {
      item.displayReplyAllForm(body);
    }
    return;
  }
  if (supportsAsync) {
    await callOfficeAsync<void>((callback) =>
      item.displayReplyFormAsync(body, callback),
    );
  } else {
    item.displayReplyForm(body);
  }
}
