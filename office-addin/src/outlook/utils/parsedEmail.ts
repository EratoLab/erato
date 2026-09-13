import PostalMime from "postal-mime";

import { parseMimeStructure } from "./emlMimeStructure";
import { canTrimInside, listAttachmentLeaves } from "./trimEmlAttachments";

import type { Address, Attachment } from "postal-mime";

export interface ParsedEmailAddress {
  name: string;
  address: string;
}

export interface ParsedAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  disposition: "attachment" | "inline" | null;
  related: boolean;
  contentId: string | null;
  toFile: () => File;
  /**
   * The forwarded email inside a `message/rfc822` part, parsed in turn. Its
   * attachment ids extend this part's id (`att-1/att-0`), so one flat set of
   * ids addresses every level. Absent when the part is too deep, too large,
   * or does not parse.
   */
  nested?: ParsedEmail;
  /**
   * Whether a dismissal inside `nested` can be cut out of this email's bytes.
   * False when the forward is transfer-encoded: its parts are not addressable
   * in place, so only the forward as a whole can be left out. Present with
   * `nested` only.
   */
  nestedTrimmable?: boolean;
}

export interface ParsedEmail {
  /** The parsed bytes; `rawEmlFile` holds a copy. */
  rawBytes: ArrayBuffer;
  rawEmlFile: File;
  messageId: string | null;
  subject: string | null;
  from: ParsedEmailAddress | null;
  to: ParsedEmailAddress[];
  cc: ParsedEmailAddress[];
  bcc: ParsedEmailAddress[];
  date: string | null;
  text: string | null;
  html: string | null;
  attachments: ParsedAttachment[];
}

export interface ParseEmlBytesOptions {
  /** File name to surface on the wrapped `.eml` File. Defaults to a sanitised subject. */
  filename?: string;
  /**
   * Prepended to every attachment id (`<prefix>att-0`, and on down into
   * forwards). Lets a caller that holds several parsed emails keep one flat
   * id set.
   */
  idPrefix?: string;
}

export async function parseEmlBytes(
  bytes: ArrayBuffer,
  options: ParseEmlBytesOptions = {},
): Promise<ParsedEmail | null> {
  return parseEmlBytesAt(bytes, options, 0, options.idPrefix ?? "");
}

/** Forwarded emails nest no deeper than this; beyond it a part stays opaque. */
const MAX_NESTED_DEPTH = 3;
/** Above this a forwarded email is not expanded; parsing it would stall the drop. */
export const NESTED_PARSE_LIMIT_BYTES = 25 * 1024 * 1024;

async function parseEmlBytesAt(
  bytes: ArrayBuffer,
  options: ParseEmlBytesOptions,
  depth: number,
  idPrefix: string,
): Promise<ParsedEmail | null> {
  let parsed;
  try {
    // Forced so a forwarded email is one attachment (never inlined, whatever
    // its disposition) and the trim walker's leaf indices line up with this list.
    parsed = await PostalMime.parse(bytes, { forceRfc822Attachments: true });
  } catch (error) {
    console.warn("[parsedEmail] postal-mime failed to parse bytes:", error);
    return null;
  }

  const rawAttachments = parsed.attachments ?? [];
  const trimmableLeaves = rawAttachments.some(isMessagePart)
    ? listTrimmableLeaves(bytes)
    : [];
  const attachments: ParsedAttachment[] = await Promise.all(
    rawAttachments.map((attachment, index) =>
      buildAttachment(
        attachment,
        `${idPrefix}att-${index}`,
        depth,
        trimmableLeaves[index] === true,
      ),
    ),
  );

  const rawEmlFile = new File(
    [bytes],
    options.filename ?? buildDefaultName(parsed.subject),
    {
      type: "message/rfc822",
    },
  );

  return {
    rawBytes: bytes,
    rawEmlFile,
    messageId: parsed.messageId ?? null,
    subject: nullIfEmpty(parsed.subject),
    from: normalizeSingleAddress(parsed.from),
    to: normalizeAddressList(parsed.to),
    cc: normalizeAddressList(parsed.cc),
    bcc: normalizeAddressList(parsed.bcc),
    date: parsed.date ?? null,
    text: nullIfEmpty(parsed.text),
    html: nullIfEmpty(parsed.html),
    attachments,
  };
}

function isMessagePart(attachment: Attachment): boolean {
  return (attachment.mimeType || "").trim().toLowerCase() === "message/rfc822";
}

/**
 * Per attachment, in postal-mime's order, whether the trimmer can reach into
 * it. Reads the same leaf list the trimmer walks, so the indices agree.
 */
function listTrimmableLeaves(bytes: ArrayBuffer): boolean[] {
  const root = parseMimeStructure(new Uint8Array(bytes));
  if (!root) return [];
  return listAttachmentLeaves(root).map(canTrimInside);
}

async function buildAttachment(
  attachment: Attachment,
  id: string,
  depth: number,
  trimmable: boolean,
): Promise<ParsedAttachment> {
  const mimeType = attachment.mimeType || "application/octet-stream";
  const isMessage = isMessagePart(attachment);
  const blobPart = toBlobPart(attachment.content);
  const size = blobPart instanceof ArrayBuffer ? blobPart.byteLength : 0;
  const nested =
    isMessage &&
    depth < MAX_NESTED_DEPTH &&
    blobPart instanceof ArrayBuffer &&
    blobPart.byteLength <= NESTED_PARSE_LIMIT_BYTES
      ? ((await parseEmlBytesAt(blobPart, {}, depth + 1, `${id}/`)) ??
        undefined)
      : undefined;
  // A forwarded email usually has no filename; name it after its subject.
  const filename =
    attachment.filename?.trim() ||
    (isMessage ? buildDefaultName(nested?.subject ?? undefined) : null) ||
    "attachment";
  return {
    id,
    filename,
    mimeType,
    size,
    disposition: attachment.disposition ?? null,
    related: attachment.related === true,
    contentId: attachment.contentId ?? null,
    toFile: () =>
      blobPart === null
        ? new File([], filename, { type: mimeType })
        : new File([blobPart], filename, { type: mimeType }),
    ...(nested ? { nested, nestedTrimmable: trimmable } : {}),
  };
}

function toBlobPart(
  content: ArrayBuffer | Uint8Array | string,
): BlobPart | null {
  if (typeof content === "string") {
    const encoded = new TextEncoder().encode(content);
    const copy = new Uint8Array(encoded.byteLength);
    copy.set(encoded);
    return copy.buffer;
  }
  if (content instanceof Uint8Array) {
    const copy = new Uint8Array(content.byteLength);
    copy.set(content);
    return copy.buffer;
  }
  if (content instanceof ArrayBuffer) {
    return content;
  }
  return null;
}

function nullIfEmpty(value: string | undefined): string | null {
  if (value === undefined) return null;
  return value.trim().length === 0 ? null : value;
}

function normalizeSingleAddress(
  addr: Address | undefined,
): ParsedEmailAddress | null {
  if (!addr) return null;
  if (addr.address !== undefined) {
    return { name: addr.name, address: addr.address };
  }
  const first = addr.group[0];
  return first ? { name: first.name, address: first.address } : null;
}

function normalizeAddressList(
  addrs: Address[] | undefined,
): ParsedEmailAddress[] {
  if (!addrs) return [];
  return addrs.flatMap((addr): ParsedEmailAddress[] => {
    if (addr.address !== undefined) {
      return [{ name: addr.name, address: addr.address }];
    }
    return addr.group.map((m) => ({ name: m.name, address: m.address }));
  });
}

function buildDefaultName(subject: string | undefined): string {
  if (!subject || subject.trim().length === 0) return "message.eml";
  const safe = subject
    .trim()
    .replace(/[\\/:*?"<>|\s\u0000-\u001f]+/g, "_")
    .slice(0, 80);
  return `${safe}.eml`;
}
