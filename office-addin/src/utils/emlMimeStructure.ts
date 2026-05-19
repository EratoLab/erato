/**
 * Byte-level MIME walker for `.eml` surgical editing.
 *
 * Returns a tree of parts with their byte ranges in the original input —
 * enough information for `trimEmlAttachments` to splice deselected parts
 * out of the raw bytes without re-encoding the surviving parts.
 *
 * Scope: deliberately minimal. Handles standard multipart structures
 * (multipart/mixed, multipart/alternative, multipart/related, arbitrary
 * nesting). Does not attempt to decode encoded-word filenames, parse
 * RFC 2231 multi-line parameters, or validate transfer encodings — all
 * downstream code only cares about byte ranges and the unaltered raw
 * header text.
 */

export interface MimeHeader {
  /** Lower-cased name. */
  name: string;
  /** Original casing as it appeared in the input. */
  raw: string;
  /** Unfolded value (continuation lines joined with a single space). */
  value: string;
}

export interface MimePart {
  /**
   * Byte offset of the introducing `--boundary` delimiter for this child
   * part. `null` for the root part. The trim splice range for a child is
   * `[delimiterStart, end)` so removal sweeps the delimiter line away with
   * the part, leaving the next part's delimiter intact.
   */
  delimiterStart: number | null;
  /** First byte of this part's header block. */
  headerStart: number;
  /** First byte of this part's body (after the blank line separator). */
  bodyStart: number;
  /** Exclusive end of this part's content (boundary of the next sibling, or end of input). */
  end: number;
  headers: MimeHeader[];
  /** Lower-cased main content type, e.g. `multipart/mixed`. Empty string if header missing. */
  contentType: string;
  contentTypeParams: Record<string, string>;
  contentDisposition: string | null;
  contentDispositionParams: Record<string, string>;
  /** Decoded multipart boundary parameter (without surrounding quotes). `null` for non-multipart parts. */
  boundary: string | null;
  isMultipart: boolean;
  children: MimePart[];
}

export function parseMimeStructure(bytes: Uint8Array): MimePart | null {
  try {
    return parsePart(bytes, 0, bytes.length, null);
  } catch (error) {
    console.warn("[emlMimeStructure] parse failed:", error);
    return null;
  }
}

/**
 * Depth-first list of every non-multipart leaf part, in document order.
 * Matches the iteration order postal-mime uses to build its flat
 * `attachments` array (postal-mime walks the same tree depth-first).
 */
export function listLeafParts(root: MimePart): MimePart[] {
  const out: MimePart[] = [];
  walkLeaves(root, out);
  return out;
}

function walkLeaves(part: MimePart, sink: MimePart[]): void {
  if (part.isMultipart) {
    for (const child of part.children) {
      walkLeaves(child, sink);
    }
    return;
  }
  sink.push(part);
}

function parsePart(
  bytes: Uint8Array,
  partStart: number,
  partEnd: number,
  delimiterStart: number | null,
): MimePart {
  const headerEnd = findHeaderEnd(bytes, partStart, partEnd);
  const headers = parseHeaders(bytes, partStart, headerEnd.headersEnd);
  const ctHeader = findHeader(headers, "content-type");
  const cdHeader = findHeader(headers, "content-disposition");
  const { value: contentType, params: contentTypeParams } = parseStructured(
    ctHeader?.value ?? "",
  );
  const {
    value: contentDispositionValue,
    params: contentDispositionParams,
  } = parseStructured(cdHeader?.value ?? "");
  const contentDisposition = contentDispositionValue || null;
  const lowerCt = contentType.toLowerCase();
  const isMultipart = lowerCt.startsWith("multipart/");
  const boundary = isMultipart
    ? contentTypeParams.boundary ?? null
    : null;
  const children: MimePart[] = [];
  if (isMultipart && boundary) {
    children.push(
      ...splitMultipart(bytes, headerEnd.bodyStart, partEnd, boundary),
    );
  }
  return {
    delimiterStart,
    headerStart: partStart,
    bodyStart: headerEnd.bodyStart,
    end: partEnd,
    headers,
    contentType: lowerCt,
    contentTypeParams,
    contentDisposition,
    contentDispositionParams,
    boundary,
    isMultipart,
    children,
  };
}

interface HeaderEnd {
  headersEnd: number;
  bodyStart: number;
}

function findHeaderEnd(bytes: Uint8Array, start: number, end: number): HeaderEnd {
  // Look for the first blank line: CRLFCRLF or LFLF.
  for (let i = start; i < end - 1; i++) {
    if (
      bytes[i] === 0x0d &&
      bytes[i + 1] === 0x0a &&
      bytes[i + 2] === 0x0d &&
      bytes[i + 3] === 0x0a
    ) {
      return { headersEnd: i, bodyStart: i + 4 };
    }
    if (bytes[i] === 0x0a && bytes[i + 1] === 0x0a) {
      return { headersEnd: i, bodyStart: i + 2 };
    }
  }
  // No blank line — treat the whole thing as headers, body is empty.
  return { headersEnd: end, bodyStart: end };
}

function parseHeaders(bytes: Uint8Array, start: number, end: number): MimeHeader[] {
  const text = decodeAscii(bytes, start, end);
  const lines = text.split(/\r?\n/);
  const unfolded: string[] = [];
  for (const line of lines) {
    if (line.length === 0) continue;
    if ((line.startsWith(" ") || line.startsWith("\t")) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += " " + line.trim();
    } else {
      unfolded.push(line);
    }
  }
  const result: MimeHeader[] = [];
  for (const raw of unfolded) {
    const colon = raw.indexOf(":");
    if (colon <= 0) continue;
    const name = raw.slice(0, colon).trim();
    const value = raw.slice(colon + 1).trim();
    result.push({ name: name.toLowerCase(), raw: name, value });
  }
  return result;
}

function findHeader(headers: MimeHeader[], name: string): MimeHeader | undefined {
  return headers.find((header) => header.name === name);
}

interface StructuredHeader {
  value: string;
  params: Record<string, string>;
}

function parseStructured(raw: string): StructuredHeader {
  if (raw.length === 0) return { value: "", params: {} };
  const parts = splitHeaderParts(raw);
  const value = parts[0]?.trim() ?? "";
  const params: Record<string, string> = {};
  for (let i = 1; i < parts.length; i++) {
    const eq = parts[i].indexOf("=");
    if (eq <= 0) continue;
    const key = parts[i].slice(0, eq).trim().toLowerCase();
    let val = parts[i].slice(eq + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1);
    }
    if (key.length > 0) {
      params[key] = val;
    }
  }
  return { value, params };
}

function splitHeaderParts(raw: string): string[] {
  // Split on `;` outside of double-quoted strings.
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const char of raw) {
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
      continue;
    }
    if (char === ";" && !inQuotes) {
      out.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current.length > 0) out.push(current);
  return out;
}

function splitMultipart(
  bytes: Uint8Array,
  bodyStart: number,
  bodyEnd: number,
  boundary: string,
): MimePart[] {
  // Locate every occurrence of "--boundary" that sits at the start of a
  // line (or at body start). Each occurrence either introduces a part
  // ("--boundary\r\n" or "--boundary\n") or closes the multipart
  // ("--boundary--").
  const boundaryBytes = encodeAscii(boundary);
  const delimiters = findDelimiters(
    bytes,
    bodyStart,
    bodyEnd,
    boundaryBytes,
  );
  const children: MimePart[] = [];
  for (let i = 0; i < delimiters.length - 1; i++) {
    const current = delimiters[i];
    if (current.isClose) break;
    // Skip preamble: the bytes between bodyStart and the first delimiter
    // are RFC-2046 "preamble" and aren't a part.
    const partHeaderStart = current.contentStart;
    const next = delimiters[i + 1];
    const partEnd = next.delimiterStart;
    children.push(
      parsePart(bytes, partHeaderStart, partEnd, current.delimiterStart),
    );
    if (next.isClose) break;
  }
  return children;
}

interface DelimiterMatch {
  delimiterStart: number;
  contentStart: number;
  isClose: boolean;
}

function findDelimiters(
  bytes: Uint8Array,
  start: number,
  end: number,
  boundary: Uint8Array,
): DelimiterMatch[] {
  const matches: DelimiterMatch[] = [];
  let cursor = start;
  while (cursor < end) {
    const candidate = indexOfBoundary(bytes, cursor, end, boundary);
    if (candidate === -1) break;
    // Validate that the delimiter sits at the start of the body or at a
    // line boundary. Skip false positives (boundary appearing inside an
    // encoded part body — uncommon since boundaries are uniquified, but
    // worth defending against).
    if (candidate !== start) {
      const prev = bytes[candidate - 1];
      if (prev !== 0x0a) {
        cursor = candidate + 1;
        continue;
      }
    }
    // Match the "--boundary" prefix bytes.
    const afterPrefix = candidate + 2 + boundary.length;
    if (afterPrefix > end) break;
    const isClose =
      afterPrefix + 1 < end &&
      bytes[afterPrefix] === 0x2d &&
      bytes[afterPrefix + 1] === 0x2d;
    // Find the end of this delimiter line (CRLF or LF).
    let lineEnd = afterPrefix + (isClose ? 2 : 0);
    while (
      lineEnd < end &&
      bytes[lineEnd] !== 0x0a &&
      bytes[lineEnd] !== 0x0d
    ) {
      lineEnd++;
    }
    if (lineEnd < end && bytes[lineEnd] === 0x0d) lineEnd++;
    if (lineEnd < end && bytes[lineEnd] === 0x0a) lineEnd++;
    matches.push({
      delimiterStart: candidate,
      contentStart: lineEnd,
      isClose,
    });
    cursor = lineEnd;
    if (isClose) break;
  }
  return matches;
}

function indexOfBoundary(
  bytes: Uint8Array,
  start: number,
  end: number,
  boundary: Uint8Array,
): number {
  outer: for (let i = start; i <= end - 2 - boundary.length; i++) {
    if (bytes[i] !== 0x2d || bytes[i + 1] !== 0x2d) continue;
    for (let j = 0; j < boundary.length; j++) {
      if (bytes[i + 2 + j] !== boundary[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function decodeAscii(bytes: Uint8Array, start: number, end: number): string {
  let out = "";
  for (let i = start; i < end; i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

function encodeAscii(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    out[i] = text.charCodeAt(i) & 0xff;
  }
  return out;
}
