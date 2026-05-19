import { listLeafParts, parseMimeStructure } from "./emlMimeStructure";

import type { MimePart } from "./emlMimeStructure";

/**
 * Surgically removes specific attachment parts from a `.eml` byte stream.
 *
 * Matching contract: `attachmentIndicesToRemove` are indices into the same
 * flat ordering postal-mime produces for `Email.attachments` — i.e. the
 * depth-first sequence of leaf parts that are "attachment-like" (have a
 * Content-Disposition, a Content-ID, or are non-text). Body parts
 * (text/plain and text/html at the top of a multipart/alternative) are
 * skipped, matching postal-mime's behaviour.
 *
 * Returns the original bytes verbatim when nothing is removed (fast path),
 * a trimmed copy when removals succeed, or `null` when the structure
 * cannot be parsed safely. Callers should fall back to shipping the
 * untrimmed bytes on `null` rather than skipping the upload.
 */
export function trimEmlAttachments(
  emlBytes: Uint8Array,
  attachmentIndicesToRemove: number[],
): Uint8Array | null {
  if (attachmentIndicesToRemove.length === 0) {
    return emlBytes;
  }
  const root = parseMimeStructure(emlBytes);
  if (!root) {
    return null;
  }
  const attachmentLeaves = listAttachmentLeaves(root);
  const rangesToRemove: { start: number; end: number }[] = [];
  for (const index of attachmentIndicesToRemove) {
    const leaf = attachmentLeaves[index];
    if (!leaf || leaf.delimiterStart === null) {
      return null;
    }
    rangesToRemove.push({ start: leaf.delimiterStart, end: leaf.end });
  }
  rangesToRemove.sort((a, b) => a.start - b.start);
  return spliceRanges(emlBytes, rangesToRemove);
}

/**
 * Flat list of leaf parts that postal-mime would surface as attachments.
 * Public so tests can verify ordering parity against `parsed.attachments`.
 */
export function listAttachmentLeaves(root: MimePart): MimePart[] {
  return listLeafParts(root).filter(isAttachmentLeaf);
}

function isAttachmentLeaf(part: MimePart): boolean {
  if (part.isMultipart) {
    return false;
  }
  const disposition = part.contentDisposition;
  if (disposition === "attachment" || disposition === "inline") {
    return true;
  }
  if (hasHeader(part, "content-id")) {
    return true;
  }
  const ct = part.contentType;
  if (ct === "text/plain" || ct === "text/html") {
    return false;
  }
  return true;
}

function hasHeader(part: MimePart, name: string): boolean {
  return part.headers.some((header) => header.name === name);
}

function spliceRanges(
  bytes: Uint8Array,
  rangesToRemove: { start: number; end: number }[],
): Uint8Array {
  if (rangesToRemove.length === 0) {
    return bytes;
  }
  let removed = 0;
  for (const range of rangesToRemove) {
    removed += range.end - range.start;
  }
  const out = new Uint8Array(bytes.length - removed);
  let writeCursor = 0;
  let readCursor = 0;
  for (const range of rangesToRemove) {
    const chunkLength = range.start - readCursor;
    if (chunkLength > 0) {
      out.set(bytes.subarray(readCursor, range.start), writeCursor);
      writeCursor += chunkLength;
    }
    readCursor = range.end;
  }
  if (readCursor < bytes.length) {
    out.set(bytes.subarray(readCursor), writeCursor);
  }
  return out;
}
