import PostalMime from "postal-mime";

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
}

export interface ParsedEmail {
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
}

export async function parseEmlBytes(
  bytes: ArrayBuffer,
  options: ParseEmlBytesOptions = {},
): Promise<ParsedEmail | null> {
  let parsed;
  try {
    // A forwarded email must stay one attachment. Left to its default,
    // postal-mime inlines a disposition-less message/rfc822 part and hoists
    // its attachments into this list, while the trim walker still sees the
    // nested message as a single leaf — so the indices the chips dismiss no
    // longer name the parts the trim removes.
    parsed = await PostalMime.parse(bytes, { rfc822Attachments: true });
  } catch (error) {
    console.warn("[parsedEmail] postal-mime failed to parse bytes:", error);
    return null;
  }

  const attachments: ParsedAttachment[] = await Promise.all(
    (parsed.attachments ?? []).map(async (attachment, index) =>
      buildAttachment(attachment, index, await nestedMessageName(attachment)),
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

/**
 * A forwarded email arrives as a message/rfc822 part that usually carries no
 * filename. Name it after its own subject so the row reads as the email it
 * is, rather than as "attachment".
 */
async function nestedMessageName(
  attachment: Attachment,
): Promise<string | null> {
  if (attachment.mimeType !== "message/rfc822" || attachment.filename?.trim()) {
    return null;
  }
  const blobPart = toBlobPart(attachment.content);
  if (!(blobPart instanceof ArrayBuffer)) {
    return buildDefaultName(undefined);
  }
  try {
    const nested = await PostalMime.parse(new Uint8Array(blobPart));
    return buildDefaultName(nested.subject);
  } catch {
    return buildDefaultName(undefined);
  }
}

function buildAttachment(
  attachment: Attachment,
  index: number,
  nameFallback: string | null,
): ParsedAttachment {
  const filename = attachment.filename?.trim() || nameFallback || "attachment";
  const mimeType = attachment.mimeType || "application/octet-stream";
  const blobPart = toBlobPart(attachment.content);
  const size = blobPart instanceof ArrayBuffer ? blobPart.byteLength : 0;
  return {
    id: `att-${index}`,
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
