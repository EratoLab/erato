import { callOfficeAsync } from "./officeAsync";
import { sanitizeReplyFormHtml } from "./sanitizeReplyFormHtml";
import { isMessageRead } from "../sessionPolicy/outlookAnchor";

import type { OutlookClientAction } from "./outlookClientActions";

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
  const item = Office.context?.mailbox?.item as
    | Office.MessageRead
    | Office.MessageCompose
    | null
    | undefined;
  if (!item || !isMessageRead(item)) {
    return null;
  }
  return item;
}

/**
 * Whether the current Office context can open a reply form right now: a
 * read-mode message is open and the host supports the reply form APIs
 * (Mailbox 1.1; not available on Outlook mobile).
 */
export function isReadReplySupported(): boolean {
  if (!getReadModeItem()) {
    return false;
  }
  return (
    Office.context.requirements?.isSetSupported?.("Mailbox", "1.1") ?? false
  );
}

export interface ReadModeRecipientSummary {
  /** Sender display name or address — the target of a plain reply. */
  sender: string | null;
  /** Display names/addresses on To + Cc of the message being read. */
  recipients: string[];
}

/**
 * Re-read the recipients of the CURRENT read-mode item at confirmation time.
 * Outlook itself derives the actual reply-all recipient set when the form
 * opens; this summary exists so the user confirms against fresh data, not
 * against whatever the chat message was generated from.
 */
export function getReadModeRecipientSummary(): ReadModeRecipientSummary | null {
  const item = getReadModeItem();
  if (!item) {
    return null;
  }
  const format = (details: Office.EmailAddressDetails): string =>
    details.displayName || details.emailAddress;
  return {
    sender: item.from ? format(item.from) : null,
    recipients: [...(item.to ?? []), ...(item.cc ?? [])].map(format),
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
  action: OutlookClientAction,
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
