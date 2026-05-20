/**
 * Build a single `.eml` File representing an entire Outlook conversation
 * thread. The output is a `multipart/mixed` envelope where every thread
 * member is wrapped as a nested `message/rfc822` part — each carrying its
 * own headers, body, and (non-inline) attachments.
 *
 * Why one synthesized envelope instead of N separate uploads:
 *   - The backend's kreuzberg extractor recurses into nested rfc822 parts,
 *     so a single upload still gives the LLM per-message context (sender,
 *     date, body, attachments) without flattening filenames into
 *     ambiguous siblings (think three `Lastenheft.pdf` versions across
 *     three replies — MIME structure preserves which version came from
 *     which message).
 *   - The frontend's EmlPreview already recurses into nested message
 *     attachments via FilePreviewContent (see commit a25a5966).
 *
 * Encoding choices kept deliberately simple:
 *   - Bodies: HTML when present, else plain text. UTF-8 + base64, line-
 *     wrapped at 76 cols. No multipart/alternative — saves bytes and the
 *     LLM only consumes one body either way.
 *   - Headers: RFC 2047 encoded-word (=?utf-8?B?…?=) when non-ASCII.
 *   - Inline attachments are dropped at the call-site (mirroring the
 *     existing chat-input filter for `disposition === "inline" || related`).
 */

const CRLF = "\r\n";
const BASE64_LINE_LENGTH = 76;

export interface ThreadMessageInput {
  /** RFC 5322 Message-ID. Written as the nested message's Message-ID header. */
  internetMessageId: string | null;
  subject: string;
  from: { name: string; address: string } | null;
  to: { name: string; address: string }[];
  cc: { name: string; address: string }[];
  /** ISO 8601 timestamp (e.g. Graph's receivedDateTime/sentDateTime). */
  date: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  attachments: ThreadAttachmentInput[];
}

export interface ThreadAttachmentInput {
  filename: string;
  mimeType: string;
  contentBytes: ArrayBuffer | Uint8Array;
}

export interface SynthesizeThreadOptions {
  /** Subject of the outer envelope. Usually the latest message's subject. */
  subject: string;
  messages: ThreadMessageInput[];
  /** Filename of the resulting File. Defaults to a slug of `subject`. */
  filename?: string;
}

export function synthesizeThreadEml(options: SynthesizeThreadOptions): File {
  const { subject, messages } = options;
  const outerBoundary = generateBoundary("thread");
  const segments: Uint8Array[] = [];

  segments.push(
    asciiBytes(
      buildHeaderBlock([
        ["Subject", encodeHeader(subject)],
        ["Date", formatRfcDate(latestDate(messages))],
        ["MIME-Version", "1.0"],
        ["Content-Type", `multipart/mixed; boundary="${outerBoundary}"`],
      ]),
    ),
  );

  for (let i = 0; i < messages.length; i += 1) {
    const nestedBytes = buildNestedMessage(messages[i]);
    segments.push(asciiBytes(`--${outerBoundary}${CRLF}`));
    segments.push(
      asciiBytes(
        buildHeaderBlock([
          ["Content-Type", "message/rfc822"],
          [
            "Content-Disposition",
            `attachment; filename="message-${i + 1}.eml"`,
          ],
        ]),
      ),
    );
    segments.push(nestedBytes);
    segments.push(asciiBytes(CRLF));
  }
  segments.push(asciiBytes(`--${outerBoundary}--${CRLF}`));

  const filename = options.filename ?? slugFilename(subject);
  // The `as BlobPart[]` cast looks suspicious but is structurally sound:
  // TS lib types advertise `Uint8Array<ArrayBufferLike>` and `BlobPart`
  // doesn't accept the `SharedArrayBuffer`-aware union. At runtime each
  // segment is a regular `Uint8Array` over an `ArrayBuffer`, which `File`
  // accepts. The alternative — converting each segment to a `Blob` first
  // — would copy bytes unnecessarily.
  return new File(segments as BlobPart[], filename, {
    type: "message/rfc822",
  });
}

function buildNestedMessage(message: ThreadMessageInput): Uint8Array {
  const headerLines: [string, string][] = [];
  if (message.from) {
    headerLines.push(["From", formatAddress(message.from)]);
  }
  if (message.to.length > 0) {
    headerLines.push(["To", formatAddressList(message.to)]);
  }
  if (message.cc.length > 0) {
    headerLines.push(["Cc", formatAddressList(message.cc)]);
  }
  headerLines.push(["Subject", encodeHeader(message.subject)]);
  headerLines.push(["Date", formatRfcDate(message.date)]);
  if (message.internetMessageId) {
    headerLines.push(["Message-ID", message.internetMessageId]);
  }
  headerLines.push(["MIME-Version", "1.0"]);

  const hasAttachments = message.attachments.length > 0;
  const bodyMime = message.bodyHtml ? "text/html" : "text/plain";
  const bodyText = message.bodyHtml ?? message.bodyText ?? "";

  if (!hasAttachments) {
    headerLines.push(["Content-Type", `${bodyMime}; charset=utf-8`]);
    headerLines.push(["Content-Transfer-Encoding", "base64"]);
    return concatBytes([
      asciiBytes(buildHeaderBlock(headerLines)),
      asciiBytes(encodeBodyBase64(bodyText)),
    ]);
  }

  const messageBoundary = generateBoundary("msg");
  headerLines.push([
    "Content-Type",
    `multipart/mixed; boundary="${messageBoundary}"`,
  ]);

  const segments: Uint8Array[] = [];
  segments.push(asciiBytes(buildHeaderBlock(headerLines)));
  segments.push(asciiBytes(`--${messageBoundary}${CRLF}`));
  segments.push(
    asciiBytes(
      buildHeaderBlock([
        ["Content-Type", `${bodyMime}; charset=utf-8`],
        ["Content-Transfer-Encoding", "base64"],
      ]),
    ),
  );
  segments.push(asciiBytes(encodeBodyBase64(bodyText)));
  segments.push(asciiBytes(CRLF));

  for (const attachment of message.attachments) {
    segments.push(asciiBytes(`--${messageBoundary}${CRLF}`));
    const mimeType = attachment.mimeType || "application/octet-stream";
    segments.push(
      asciiBytes(
        buildHeaderBlock([
          [
            "Content-Type",
            `${mimeType}${filenameParam(attachment.filename, "name")}`,
          ],
          [
            "Content-Disposition",
            `attachment${filenameParam(attachment.filename, "filename")}`,
          ],
          ["Content-Transfer-Encoding", "base64"],
        ]),
      ),
    );
    segments.push(
      asciiBytes(wrapBase64(base64Encode(toBytes(attachment.contentBytes)))),
    );
    segments.push(asciiBytes(CRLF));
  }
  segments.push(asciiBytes(`--${messageBoundary}--${CRLF}`));
  return concatBytes(segments);
}

function buildHeaderBlock(lines: [string, string][]): string {
  let block = "";
  for (const [name, value] of lines) {
    block += `${name}: ${value}${CRLF}`;
  }
  block += CRLF;
  return block;
}

function encodeBodyBase64(body: string): string {
  return `${wrapBase64(base64Encode(utf8Bytes(body)))}${CRLF}`;
}

function formatAddress(addr: { name: string; address: string }): string {
  const trimmedName = addr.name.trim();
  if (trimmedName.length === 0) {
    return addr.address;
  }
  return `${encodeHeader(trimmedName)} <${addr.address}>`;
}

function formatAddressList(addrs: { name: string; address: string }[]): string {
  return addrs.map(formatAddress).join(", ");
}

/**
 * RFC 2047 §2 caps each encoded-word at 75 characters total. Long non-ASCII
 * headers (e.g. a 40-character German subject with umlauts) easily exceed
 * that in a single `=?utf-8?B?<base64>?=` token — some mailers reject those.
 * We split the UTF-8 byte stream into chunks whose base64 fits the budget,
 * always honouring code-point boundaries so multi-byte runes stay intact,
 * and join encoded-words with `CRLF SPACE` (RFC 2822 folding whitespace).
 */
function encodeHeader(value: string): string {
  if (isPrintableAscii(value)) return value;
  // 75 - len("=?utf-8?B??=") = 63 chars of base64 budget per word; base64 expands
  // each 3 bytes to 4 chars, so 45 source bytes -> 60 base64 chars fits.
  const ENCODED_WORD_BYTE_BUDGET = 45;
  const bytes = utf8Bytes(value);
  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < bytes.length) {
    let end = Math.min(cursor + ENCODED_WORD_BYTE_BUDGET, bytes.length);
    // Pull `end` back to the start of a UTF-8 code point so we never split
    // a multibyte sequence mid-way. Continuation bytes are `10xxxxxx`.
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) {
      end -= 1;
    }
    if (end <= cursor) end = bytes.length; // pathological — emit whatever we have
    chunks.push(`=?utf-8?B?${base64Encode(bytes.subarray(cursor, end))}?=`);
    cursor = end;
  }
  return chunks.join(`${CRLF} `);
}

function isPrintableAscii(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) return false;
  }
  return true;
}

/**
 * Build a `; name="…"` or `; filename="…"` parameter that respects RFC 2231
 * when the value is non-ASCII. RFC 2047 encoded-words are *not* legal inside
 * a quoted-string — postal-mime is lenient, but Outlook/Apple Mail surface
 * raw `=?utf-8?B?…?=` to the user if we emit them there. RFC 2231 syntax
 * `name*=utf-8''<percent-encoded>` is the portable form.
 */
function filenameParam(filename: string, parameterName: string): string {
  if (filename.length === 0) return "";
  if (isQuotedStringSafe(filename)) {
    return `; ${parameterName}="${filename}"`;
  }
  return `; ${parameterName}*=utf-8''${rfc2231PercentEncode(filename)}`;
}

function isQuotedStringSafe(value: string): boolean {
  // ASCII-printable, no `"` or `\` (would need escaping). Conservative.
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) return false;
    if (code === 0x22 || code === 0x5c) return false;
  }
  return true;
}

function rfc2231PercentEncode(value: string): string {
  // Encode all bytes except RFC 5987 "attr-char": ALPHA / DIGIT / and a
  // narrow punctuation set. encodeURIComponent over-encodes a few safe
  // chars but stays inside the allowed grammar, so it's a sound default.
  const encoded = encodeURIComponent(value);
  return encoded.replace(/[!*'()]/g, (ch) => {
    return `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`;
  });
}

function formatRfcDate(iso: string | null): string {
  if (!iso) return new Date().toUTCString();
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return new Date().toUTCString();
  return parsed.toUTCString();
}

function latestDate(messages: ThreadMessageInput[]): string | null {
  let latest: number | null = null;
  for (const message of messages) {
    if (!message.date) continue;
    const parsed = Date.parse(message.date);
    if (Number.isNaN(parsed)) continue;
    if (latest === null || parsed > latest) {
      latest = parsed;
    }
  }
  return latest === null ? null : new Date(latest).toISOString();
}

/**
 * Cryptographically random boundary string. RFC 2046 requires boundaries
 * not to appear literally inside any encapsulated body — 128 bits of
 * entropy makes accidental collisions astronomically improbable, and the
 * randomness defeats correlation across messages.
 */
function generateBoundary(prefix: string): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return `--Erato-${prefix}-${hex}`;
}

function slugFilename(subject: string): string {
  const trimmed = subject.trim();
  if (trimmed.length === 0) return "thread.eml";
  // Collapse path-unsafe punctuation, whitespace, `_`, and `-` into a single
  // `_`. Listing `_` and `-` last in the class keeps them as literals.
  const safe = trimmed.replace(/[\\/:*?"<>|\s_-]+/g, "_").slice(0, 80);
  return `${safe}.eml`;
}

function toBytes(content: ArrayBuffer | Uint8Array): Uint8Array {
  if (content instanceof Uint8Array) return content;
  return new Uint8Array(content);
}

function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    out[i] = text.charCodeAt(i) & 0xff;
  }
  return out;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk)),
    );
  }
  return btoa(binary);
}

function wrapBase64(b64: string): string {
  if (b64.length <= BASE64_LINE_LENGTH) return b64;
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += BASE64_LINE_LENGTH) {
    lines.push(b64.slice(i, i + BASE64_LINE_LENGTH));
  }
  return lines.join(CRLF);
}
