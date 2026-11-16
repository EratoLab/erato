import { officePartPath } from "./officeXml";

/** Random access to a file's bytes, so a reader fetches only the ranges it needs. */
export interface ZipByteSource {
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export interface OfficeZip {
  has(name: string): boolean;
  /** Inflates one part. Throws OfficeZipTooLargeError past `maxBytes` before inflating. */
  read(name: string, maxBytes: number): Promise<Uint8Array>;
}

export class OfficeZipTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OfficeZipTooLargeError";
  }
}

interface Entry {
  method: number;
  compressedSize: number;
  size: number;
  headerOffset: number;
}

const END_RECORD_BYTES = 22;
const MAX_COMMENT_BYTES = 65535;
const LOCAL_HEADER_BYTES = 30;
const MAX_ENTRIES = 20_000;
const MAX_DIRECTORY_BYTES = 8 * 1024 * 1024;

/**
 * Inflates through the platform's streaming DecompressionStream, so a part that inflates past its
 * declared size is stopped there instead of running to the end on the pane's thread. Every host
 * with the PowerPoint reads has it (WebView2, and Safari 16.4+ under Microsoft 365 for Mac).
 */
async function inflateRaw(
  data: Uint8Array,
  size: number,
  name: string,
): Promise<Uint8Array> {
  let stream: DecompressionStream;
  try {
    stream = new DecompressionStream("deflate-raw");
  } catch {
    throw new Error("this web view cannot unpack the file");
  }
  const writer = stream.writable.getWriter();
  writer.write(data as Uint8Array<ArrayBuffer>).catch(() => {});
  writer.close().catch(() => {});
  const reader = stream.readable.getReader();
  const out = new Uint8Array(size);
  let offset = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.length > size) {
        await reader.cancel().catch(() => {});
        throw new Error(`${name} inflates past its declared size.`);
      }
      out.set(value, offset);
      offset += value.length;
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes(name)) throw error;
    throw new Error(`${name} could not be unpacked.`);
  }
  if (offset !== size) throw new Error(`${name} is shorter than declared.`);
  return out;
}

export function bytesSource(bytes: Uint8Array): ZipByteSource {
  return {
    size: bytes.length,
    read: (offset, length) =>
      Promise.resolve(bytes.subarray(offset, offset + length)),
  };
}

const view = (bytes: Uint8Array) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** Reads only the central directory; parts are fetched and inflated when asked for. */
export async function openOfficeZip(source: ZipByteSource): Promise<OfficeZip> {
  const tailLength = Math.min(
    source.size,
    END_RECORD_BYTES + MAX_COMMENT_BYTES,
  );
  if (tailLength < END_RECORD_BYTES) throw new Error("Not a ZIP package.");
  const tailStart = source.size - tailLength;
  const tail = await source.read(tailStart, tailLength);
  const tailView = view(tail);
  let end = tail.length - END_RECORD_BYTES;
  while (end >= 0 && tailView.getUint32(end, true) !== 0x06054b50) end--;
  if (
    end < 0 ||
    end + END_RECORD_BYTES + tailView.getUint16(end + 20, true) !== tail.length
  )
    throw new Error("Invalid ZIP directory.");
  const count = tailView.getUint16(end + 10, true);
  const directorySize = tailView.getUint32(end + 12, true);
  const directoryOffset = tailView.getUint32(end + 16, true);
  if (count === 0xffff || directoryOffset === 0xffffffff)
    throw new Error("ZIP64 packages are not supported.");
  if (count > MAX_ENTRIES || directorySize > MAX_DIRECTORY_BYTES)
    throw new OfficeZipTooLargeError(`The package has ${count} parts.`);
  if (
    tailView.getUint16(end + 4, true) ||
    tailView.getUint16(end + 6, true) ||
    directoryOffset + directorySize !== tailStart + end
  )
    throw new Error("Unsupported ZIP directory.");

  const directory = await source.read(directoryOffset, directorySize);
  const dir = view(directory);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const entries = new Map<string, Entry>();
  let cursor = 0;
  for (let i = 0; i < count; i++) {
    if (
      cursor + 46 > directory.length ||
      dir.getUint32(cursor, true) !== 0x02014b50
    )
      throw new Error("Incomplete ZIP directory.");
    const nameLength = dir.getUint16(cursor + 28, true);
    const next =
      cursor +
      46 +
      nameLength +
      dir.getUint16(cursor + 30, true) +
      dir.getUint16(cursor + 32, true);
    if (next > directory.length) throw new Error("Incomplete ZIP directory.");
    const name = decoder.decode(
      directory.subarray(cursor + 46, cursor + 46 + nameLength),
    );
    if (entries.has(name)) throw new Error("Duplicate part name.");
    // Parts with unusual names or encryption are skipped rather than failing the package; nothing
    // a slide refers to is named that way, and reading one reports it missing.
    if (
      officePartPath(name) &&
      !(dir.getUint16(cursor + 8, true) & 1) &&
      !name.endsWith("/")
    )
      entries.set(name, {
        method: dir.getUint16(cursor + 10, true),
        compressedSize: dir.getUint32(cursor + 20, true),
        size: dir.getUint32(cursor + 24, true),
        headerOffset: dir.getUint32(cursor + 42, true),
      });
    cursor = next;
  }

  return {
    has: (name) => entries.has(name),
    async read(name, maxBytes) {
      const entry = entries.get(name);
      if (!entry) throw new Error(`The package has no part ${name}.`);
      if (entry.size > maxBytes)
        throw new OfficeZipTooLargeError(
          `${name} is ${entry.size} bytes; the limit is ${maxBytes}.`,
        );
      const header = await source.read(entry.headerOffset, LOCAL_HEADER_BYTES);
      const local = view(header);
      if (
        header.length !== LOCAL_HEADER_BYTES ||
        local.getUint32(0, true) !== 0x04034b50
      )
        throw new Error(`Invalid ZIP entry ${name}.`);
      const dataOffset =
        entry.headerOffset +
        LOCAL_HEADER_BYTES +
        local.getUint16(26, true) +
        local.getUint16(28, true);
      if (dataOffset + entry.compressedSize > source.size)
        throw new Error(`Truncated ZIP entry ${name}.`);
      const data = await source.read(dataOffset, entry.compressedSize);
      if (entry.method === 0) {
        if (data.length !== entry.size)
          throw new Error(`Invalid ZIP entry ${name}.`);
        return data;
      }
      if (entry.method !== 8)
        throw new Error(`Unsupported compression in ${name}.`);
      if (entry.size === 0) return new Uint8Array(0);
      return inflateRaw(data, entry.size, name);
    },
  };
}
