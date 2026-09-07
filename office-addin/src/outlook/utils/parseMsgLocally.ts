import * as CFB from "cfb";

import {
  PROPERTIES_HEADER_SIZE,
  ROOT,
  listStorages,
  readBinaryProperty,
  readInt32Property,
  readStringProperty,
  readTimeProperty,
  resolveAnsiDecoder,
  type StoragePath,
} from "./msgProperties";
import { synthesizeMessageEml } from "./synthesizeThreadEml";

import type {
  ThreadAttachmentInput,
  ThreadMessageInput,
} from "./synthesizeThreadEml";

/**
 * Describes a dropped `.msg` from its own bytes, for the case where the mail
 * backend cannot resolve it (archive, PST, shared mailbox, deleted item).
 * The backend stays the preferred source — it owns the fidelity-sensitive
 * work — so this runs only after a lookup comes back empty.
 *
 * Deliberately does NOT read the RTF-compressed body (PidTagRtfCompressed).
 * Decompression is the one genuinely heavy part of the format, and the plain
 * text body is present far more reliably than the HTML one, so an email
 * rendered from here is plain text with its attachments intact.
 */

const MAPI = {
  internetMessageId: "1035",
  subject: "0037",
  bodyText: "1000",
  bodyHtml: "1013",
  senderName: "0C1A",
  senderSmtpAddress: "5D01",
  senderEmailAddress: "0C1F",
  clientSubmitTime: "0039",
  messageDeliveryTime: "0E06",
  displayName: "3001",
  smtpAddress: "39FE",
  emailAddress: "3003",
  recipientType: "0C15",
  attachLongFilename: "3707",
  attachFilename: "3704",
  attachMimeTag: "370E",
  attachData: "3701",
} as const;

const RECIPIENT_TYPE = { to: 1, cc: 2, bcc: 3 } as const;

export interface LocalMsgParseOptions {
  /** Overrides the synthesized `.eml` filename. Defaults to a subject slug. */
  filename?: string;
}

/**
 * Renders the `.msg` as an `.eml` File so the rest of the pipeline — preview,
 * per-attachment selection, upload — treats it exactly like every other email.
 * Returns null when the bytes are not a readable compound file.
 */
export function parseMsgLocallyToEml(
  bytes: Uint8Array,
  options: LocalMsgParseOptions = {},
): File | null {
  const message = readMsgMessage(bytes);
  if (!message) return null;
  return synthesizeMessageEml(message, { filename: options.filename });
}

export function readMsgMessage(bytes: Uint8Array): ThreadMessageInput | null {
  let container: CFB.CFB$Container;
  try {
    container = CFB.read(bytes, { type: "array" });
  } catch {
    return null;
  }

  const ansi = resolveAnsiDecoder(container);
  const str = (storage: StoragePath, tag: string) =>
    readStringProperty(container, storage, tag, ansi);

  const recipients = readRecipients(container, ansi);
  const date =
    readTimeProperty(
      container,
      ROOT,
      MAPI.clientSubmitTime,
      PROPERTIES_HEADER_SIZE.message,
    ) ??
    readTimeProperty(
      container,
      ROOT,
      MAPI.messageDeliveryTime,
      PROPERTIES_HEADER_SIZE.message,
    );

  return {
    internetMessageId: str(ROOT, MAPI.internetMessageId),
    subject: str(ROOT, MAPI.subject) ?? "",
    from: readSender(container, ansi),
    to: recipients.to,
    cc: recipients.cc,
    date: date ? date.toISOString() : null,
    bodyText: str(ROOT, MAPI.bodyText),
    bodyHtml: readHtmlBody(container, ansi),
    attachments: readAttachments(container, ansi),
  };
}

function readSender(
  container: CFB.CFB$Container,
  ansi: TextDecoder,
): ThreadMessageInput["from"] {
  const name = readStringProperty(container, ROOT, MAPI.senderName, ansi);
  const address =
    readStringProperty(container, ROOT, MAPI.senderSmtpAddress, ansi) ??
    smtpOnly(
      readStringProperty(container, ROOT, MAPI.senderEmailAddress, ansi),
    );
  if (!name && !address) return null;
  return { name: name ?? "", address: address ?? "" };
}

function readRecipients(
  container: CFB.CFB$Container,
  ansi: TextDecoder,
): { to: ThreadMessageInput["to"]; cc: ThreadMessageInput["cc"] } {
  const to: ThreadMessageInput["to"] = [];
  const cc: ThreadMessageInput["cc"] = [];

  for (const storage of listStorages(container, "__recip_version1.0_#")) {
    const name = readStringProperty(container, storage, MAPI.displayName, ansi);
    const address =
      readStringProperty(container, storage, MAPI.smtpAddress, ansi) ??
      smtpOnly(readStringProperty(container, storage, MAPI.emailAddress, ansi));
    if (!name && !address) continue;

    const entry = { name: name ?? "", address: address ?? "" };
    const type = readInt32Property(
      container,
      storage,
      MAPI.recipientType,
      PROPERTIES_HEADER_SIZE.substorage,
    );
    // Bcc is omitted so a synthesized header can never disclose more than the
    // sender chose to reveal. A Sent Items copy does carry its Bcc list, so
    // this loses those recipients — the safe direction to be wrong in.
    if (type === RECIPIENT_TYPE.bcc) continue;
    if (type === RECIPIENT_TYPE.cc) cc.push(entry);
    else to.push(entry);
  }

  return { to, cc };
}

function readAttachments(
  container: CFB.CFB$Container,
  ansi: TextDecoder,
): ThreadAttachmentInput[] {
  const attachments: ThreadAttachmentInput[] = [];

  for (const storage of listStorages(container, "__attach_version1.0_#")) {
    const contentBytes = readBinaryProperty(
      container,
      storage,
      MAPI.attachData,
    );
    // An attachment with no binary stream is an embedded message or an OLE
    // object; both need MSG recursion this reader deliberately does not do.
    if (!contentBytes) continue;

    const filename =
      readStringProperty(container, storage, MAPI.attachLongFilename, ansi) ??
      readStringProperty(container, storage, MAPI.attachFilename, ansi) ??
      "attachment";
    const mimeType = safeMimeType(
      readStringProperty(container, storage, MAPI.attachMimeTag, ansi),
    );

    attachments.push({ filename, mimeType, contentBytes });
  }

  return attachments;
}

/**
 * PidTagAttachMimeTag is written by whoever produced the `.msg`, and on this
 * path that file came from outside the mailbox. The value lands in a
 * `Content-Type:` header, so anything but a bare `type/subtype` of RFC 2045
 * token characters — a stray parameter, a CRLF — is discarded rather than
 * given the chance to reshape the part.
 */
function safeMimeType(value: string | null): string {
  const fallback = "application/octet-stream";
  if (!value) return fallback;
  return /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(value)
    ? value
    : fallback;
}

/**
 * PidTagSenderEmailAddress holds an X.500 DN for Exchange senders, which is
 * not routable and must not become a From address.
 */
function smtpOnly(address: string | null): string | null {
  if (!address) return null;
  return address.includes("@") ? address : null;
}

function readHtmlBody(
  container: CFB.CFB$Container,
  ansi: TextDecoder,
): string | null {
  const asString = readStringProperty(container, ROOT, MAPI.bodyHtml, ansi);
  if (asString) return asString;
  // PidTagBodyHtml is often stored as PtypBinary rather than a string.
  const binary = readBinaryProperty(container, ROOT, MAPI.bodyHtml);
  if (!binary) return null;
  const decoded = ansi.decode(binary).replace(/\0+$/u, "").trim();
  return decoded.length > 0 ? decoded : null;
}
