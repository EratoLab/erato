import * as CFB from "cfb";

/**
 * Minimal MAPI property reads over a `.msg` Compound File. Enough to describe
 * an email locally — subject, addresses, body, attachments — without taking on
 * full MSG semantics (no RTF decompression, no named-property resolution).
 *
 * Two format rules drive everything here, both from MS-OXMSG:
 *
 *  - A string property lives in a stream named `__substg1.0_<TAG><TYPE>`, where
 *    TYPE is `001F` for PtypString (UTF-16LE) or `001E` for PtypString8. A file
 *    is entirely one or the other and may never mix them, so trying both names
 *    and taking whichever exists is exhaustive.
 *  - Fixed-width properties are inlined in a `__properties_version1.0` stream as
 *    16-byte entries (tag, flags, 8-byte value) after a header whose size
 *    depends on what owns the stream.
 */

/** Header preceding the 16-byte entries of a `__properties_version1.0` stream. */
export const PROPERTIES_HEADER_SIZE = {
  /** Top-level message. */
  message: 32,
  /** Attachment or recipient storage. */
  substorage: 8,
} as const;

/**
 * Every path is root-anchored. `CFB.find` resolves a bare name against every
 * leaf in the tree, so an embedded message's copy of a property would otherwise
 * shadow the carrier's own.
 */
export type StoragePath = string;

export const ROOT: StoragePath = "";

export function readStringProperty(
  container: CFB.CFB$Container,
  storage: StoragePath,
  tag: string,
  ansiDecoder: TextDecoder,
): string | null {
  return (
    decodeStream(container, `${storage}/__substg1.0_${tag}001F`, UTF16LE) ??
    decodeStream(container, `${storage}/__substg1.0_${tag}001E`, ansiDecoder)
  );
}

export function readBinaryProperty(
  container: CFB.CFB$Container,
  storage: StoragePath,
  tag: string,
): Uint8Array | null {
  const bytes = readStream(container, `${storage}/__substg1.0_${tag}0102`);
  return bytes && bytes.length > 0 ? bytes : null;
}

export function readInt32Property(
  container: CFB.CFB$Container,
  storage: StoragePath,
  tag: string,
  headerSize: number,
): number | null {
  const entry = findPropertyEntry(container, storage, tag, "0003", headerSize);
  if (!entry) return null;
  let value = 0;
  for (let i = 3; i >= 0; i -= 1) value = value * 256 + entry[8 + i];
  return value;
}

/**
 * PtypTime is a FILETIME: 100-nanosecond ticks since 1601-01-01 UTC. Read as
 * two 32-bit halves and recombined in floating point, which stays exact for
 * any date this will ever see.
 */
export function readTimeProperty(
  container: CFB.CFB$Container,
  storage: StoragePath,
  tag: string,
  headerSize: number,
): Date | null {
  const entry = findPropertyEntry(container, storage, tag, "0040", headerSize);
  if (!entry) return null;
  let low = 0;
  let high = 0;
  for (let i = 3; i >= 0; i -= 1) low = low * 256 + entry[8 + i];
  for (let i = 3; i >= 0; i -= 1) high = high * 256 + entry[12 + i];
  const ticks = high * 4294967296 + low;
  if (ticks === 0) return null;
  const FILETIME_EPOCH_OFFSET_MS = 11644473600000;
  const millis = ticks / 10000 - FILETIME_EPOCH_OFFSET_MS;
  const date = new Date(millis);
  return Number.isFinite(date.getTime()) ? date : null;
}

/** Child storages of `storage` whose names start with `prefix`, in tree order. */
export function listStorages(
  container: CFB.CFB$Container,
  prefix: string,
): StoragePath[] {
  const rootPrefix = container.FullPaths[0];
  const seen = new Set<string>();
  const found: StoragePath[] = [];
  for (const fullPath of container.FullPaths) {
    if (!fullPath.startsWith(rootPrefix)) continue;
    const relative = fullPath.slice(rootPrefix.length);
    const [head] = relative.split("/");
    if (!head.startsWith(prefix) || seen.has(head)) continue;
    seen.add(head);
    found.push("/" + head);
  }
  return found;
}

/**
 * Decoder for this file's PtypString8 properties. PidTagMessageCodepage
 * describes the message's own 8-bit strings; PidTagInternetCodepage is about
 * its internet representation, so it is only a fallback. Unknown or
 * unsupported code pages fall back to windows-1252 rather than throwing —
 * a wrong accent beats losing the whole email.
 */
export function resolveAnsiDecoder(container: CFB.CFB$Container): TextDecoder {
  const codepage =
    readInt32Property(
      container,
      ROOT,
      "3FFD",
      PROPERTIES_HEADER_SIZE.message,
    ) ??
    readInt32Property(container, ROOT, "3FDE", PROPERTIES_HEADER_SIZE.message);
  return decoderForCodepage(codepage);
}

function decoderForCodepage(codepage: number | null): TextDecoder {
  const label = codepage === null ? null : CODEPAGE_LABELS[codepage];
  if (label) {
    try {
      return new TextDecoder(label);
    } catch {
      // Fall through to the default below.
    }
  }
  return new TextDecoder("windows-1252");
}

/**
 * Code pages seen on real Outlook output, plus the Western/Central European
 * neighbours a German or Eastern European mailbox is most likely to produce.
 * Anything absent decodes as windows-1252.
 */
const CODEPAGE_LABELS: Record<number, string> = {
  874: "windows-874",
  932: "shift_jis",
  936: "gbk",
  949: "euc-kr",
  950: "big5",
  1250: "windows-1250",
  1251: "windows-1251",
  1252: "windows-1252",
  1253: "windows-1253",
  1254: "windows-1254",
  1255: "windows-1255",
  1256: "windows-1256",
  1257: "windows-1257",
  1258: "windows-1258",
  10000: "macintosh",
  20866: "koi8-r",
  21866: "koi8-u",
  28591: "iso-8859-1",
  28592: "iso-8859-2",
  28595: "iso-8859-5",
  28597: "iso-8859-7",
  28599: "iso-8859-9",
  28605: "iso-8859-15",
  65001: "utf-8",
};

const UTF16LE = new TextDecoder("utf-16le");

function findPropertyEntry(
  container: CFB.CFB$Container,
  storage: StoragePath,
  tag: string,
  type: string,
  headerSize: number,
): Uint8Array | null {
  const bytes = readStream(container, `${storage}/__properties_version1.0`);
  if (!bytes) return null;
  const tagValue = Number.parseInt(tag + type, 16);
  if (!Number.isFinite(tagValue)) return null;
  const expected = [
    tagValue & 0xff,
    (tagValue >>> 8) & 0xff,
    (tagValue >>> 16) & 0xff,
    (tagValue >>> 24) & 0xff,
  ];
  for (let i = headerSize; i + 16 <= bytes.length; i += 16) {
    if (expected.every((byte, k) => bytes[i + k] === byte)) {
      return bytes.subarray(i, i + 16);
    }
  }
  return null;
}

function readStream(
  container: CFB.CFB$Container,
  path: string,
): Uint8Array | null {
  const entry = CFB.find(container, path);
  if (!entry || !entry.content) return null;
  const content = entry.content;
  return content instanceof Uint8Array ? content : new Uint8Array(content);
}

function decodeStream(
  container: CFB.CFB$Container,
  path: string,
  decoder: TextDecoder,
): string | null {
  const bytes = readStream(container, path);
  if (!bytes || bytes.length === 0) return null;
  const trimmed = decoder.decode(bytes).replace(/\0+$/u, "").trim();
  return trimmed.length > 0 ? trimmed : null;
}
