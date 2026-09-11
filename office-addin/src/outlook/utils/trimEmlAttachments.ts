import {
  listLeafParts,
  parseMimeStructure,
  parseMimeStructureAt,
} from "./emlMimeStructure";

import type { MimePart } from "./emlMimeStructure";

/**
 * An attachment to cut, addressed by its index into the same flat ordering
 * postal-mime produces for `Email.attachments` (see `listAttachmentLeaves`).
 * A path such as `"2/1"` descends into forwarded emails: each segment indexes
 * the attachment leaves of the message at that level.
 */
export type AttachmentTarget = number | string;

/** Transfer encodings under which a `message/rfc822` body is the message's raw bytes. */
const IDENTITY_TRANSFER_ENCODINGS = new Set(["", "7bit", "8bit", "binary"]);

/**
 * Surgically removes specific attachment parts from a `.eml` byte stream.
 *
 * Matching contract: `targets` are indices into the same flat ordering
 * postal-mime produces for `Email.attachments` — i.e. the depth-first
 * sequence of leaf parts that are "attachment-like" (have a
 * Content-Disposition, a Content-ID, or are non-text). Body parts
 * (text/plain and text/html at the top of a multipart/alternative) are
 * skipped, matching postal-mime's behaviour. A path target addresses an
 * attachment inside a forwarded email; when its ancestor is also targeted the
 * ancestor's removal covers it.
 *
 * Returns the original bytes verbatim when nothing is removed (fast path),
 * a trimmed copy when removals succeed, or `null` when the structure
 * cannot be parsed safely — including a path that descends into a forwarded
 * email whose body is transfer-encoded (its bytes are not addressable in
 * place). Callers should fall back to shipping the untrimmed bytes on `null`
 * rather than skipping the upload.
 */
export function trimEmlAttachments(
  emlBytes: Uint8Array,
  targets: AttachmentTarget[],
): Uint8Array | null {
  if (targets.length === 0) {
    return emlBytes;
  }
  const root = parseMimeStructure(emlBytes);
  if (!root) {
    return null;
  }
  const paths = pruneCoveredPaths(targets.map(parsePath));
  const rangesToRemove: { start: number; end: number }[] = [];
  for (const path of paths) {
    const leaf = path && resolvePath(emlBytes, root, path);
    if (!leaf || leaf.delimiterStart === null) {
      return null;
    }
    rangesToRemove.push({ start: leaf.delimiterStart, end: leaf.end });
  }
  rangesToRemove.sort((a, b) => a.start - b.start);
  return spliceRanges(emlBytes, rangesToRemove);
}

function parsePath(target: AttachmentTarget): number[] | null {
  const segments = String(target).split("/");
  const indices: number[] = [];
  for (const segment of segments) {
    if (!/^\d+$/.test(segment)) {
      return null;
    }
    indices.push(Number(segment));
  }
  return indices;
}

/** Drops repeats and every path that has another targeted path as a proper prefix. */
function pruneCoveredPaths(paths: (number[] | null)[]): (number[] | null)[] {
  return paths.filter(
    (path, i) =>
      path === null ||
      !paths.some(
        (other, j) =>
          other !== null &&
          (j < i
            ? isPrefix(other, path)
            : j > i && isProperPrefix(other, path)),
      ),
  );
}

function isPrefix(prefix: number[], path: number[]): boolean {
  return (
    prefix.length <= path.length &&
    prefix.every((index, i) => index === path[i])
  );
}

function isProperPrefix(prefix: number[], path: number[]): boolean {
  return prefix.length < path.length && isPrefix(prefix, path);
}

function resolvePath(
  bytes: Uint8Array,
  root: MimePart,
  path: number[],
): MimePart | null {
  let levelRoot: MimePart | null = root;
  let leaf: MimePart | null = null;
  for (let depth = 0; depth < path.length; depth++) {
    if (leaf) {
      if (
        leaf.contentType !== "message/rfc822" ||
        !IDENTITY_TRANSFER_ENCODINGS.has(leaf.contentTransferEncoding)
      ) {
        return null;
      }
      levelRoot = parseMimeStructureAt(bytes, leaf.bodyStart, leaf.end);
      if (!levelRoot) {
        return null;
      }
    }
    leaf = listAttachmentLeaves(levelRoot)[path[depth]] ?? null;
    if (!leaf) {
      return null;
    }
  }
  return leaf;
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
