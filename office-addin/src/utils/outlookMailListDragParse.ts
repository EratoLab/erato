/**
 * Parses the undocumented OWA/New Outlook `maillistrow` DataTransfer payload
 * emitted when a user drags one or more emails from the Outlook mail list
 * into an add-in task pane.
 *
 * Observed shape (OWA, 2026-04):
 *   {
 *     itemType: "maillistrow",
 *     itemIds: ["AAkAL..."],        // EWS ids, parallel to subjects/sizes
 *     subjects: ["Hey how are you?"],
 *     sizes: [61783],
 *     mailboxInfos: [{ mailboxSmtpAddress, userIdentity, ... }],
 *     ... (additional internal fields)
 *   }
 *
 * Contract note: this is an OWA-internal format and may change without
 * notice. Parser is defensive — returns null for any shape it does not
 * recognise rather than throwing.
 */
export const MAILLISTROW_TRANSFER_TYPE = "maillistrow";

export interface OutlookMailListDragItem {
  itemId: string;
  subject: string;
  size: number;
  mailboxSmtpAddress: string;
}

export function parseOutlookMailListPayload(
  raw: string,
): OutlookMailListDragItem[] | null {
  if (!raw) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed) || parsed.itemType !== MAILLISTROW_TRANSFER_TYPE) {
    return null;
  }

  const itemIds = asStringArray(parsed.itemIds);
  if (!itemIds || itemIds.length === 0) {
    return null;
  }

  const subjects = asStringArray(parsed.subjects) ?? [];
  const sizes = asNumberArray(parsed.sizes) ?? [];
  const mailboxInfos = Array.isArray(parsed.mailboxInfos)
    ? parsed.mailboxInfos
    : [];

  return itemIds.map((itemId, index) => ({
    itemId,
    subject: subjects[index] ?? "",
    size: sizes[index] ?? 0,
    mailboxSmtpAddress: extractMailboxSmtpAddress(mailboxInfos[index]),
  }));
}

function extractMailboxSmtpAddress(info: unknown): string {
  if (!isRecord(info)) {
    return "";
  }
  const value = info.mailboxSmtpAddress;
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  if (!value.every((entry): entry is string => typeof entry === "string")) {
    return null;
  }
  return value;
}

function asNumberArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  if (!value.every((entry): entry is number => typeof entry === "number")) {
    return null;
  }
  return value;
}
