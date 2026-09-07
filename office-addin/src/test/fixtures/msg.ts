import * as CFB from "cfb";

/**
 * Builds a minimal CFB (Compound File Binary) blob containing the given
 * named streams. Shared across tests that exercise the `.msg` parsing chain
 * — the extractor in isolation and the `parseMsgFile` glue that runs the
 * real extractor against a stubbed Graph fetch.
 */
export function buildCfbWith(
  entries: { name: string; content: Uint8Array }[],
): Uint8Array {
  const container = CFB.utils.cfb_new();
  for (const entry of entries) {
    CFB.utils.cfb_add(container, entry.name, entry.content);
  }
  const written = CFB.write(container, {
    type: "array",
  }) as unknown as ArrayLike<number>;
  return new Uint8Array(written);
}

/** UTF-16LE encoding for MAPI PT_UNICODE string properties. */
export function utf16le(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length * 2);
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    bytes[index * 2] = code & 0xff;
    bytes[index * 2 + 1] = (code >> 8) & 0xff;
  }
  return bytes;
}

/** Stream name for PR_INTERNET_MESSAGE_ID_W (MAPI tag 0x1035, PT_UNICODE). */
export const INTERNET_MESSAGE_ID_STREAM_NAME = "__substg1.0_1035001F";

/**
 * Builds a valid `.msg` CFB blob exposing only the given RFC 5322 Message-ID
 * via PR_INTERNET_MESSAGE_ID_W. Omits all other MAPI properties — the parser
 * we exercise reads exactly that one stream.
 */
export function buildMsgWithInternetMessageId(messageId: string): Uint8Array {
  return buildCfbWith([
    { name: INTERNET_MESSAGE_ID_STREAM_NAME, content: utf16le(messageId) },
  ]);
}

/** Wraps raw bytes in a File with the Outlook `.msg` MIME type. */
export function msgFileFromBytes(bytes: Uint8Array, name = "item.msg"): File {
  const buffer = new ArrayBuffer(bytes.length);
  new Uint8Array(buffer).set(bytes);
  return new File([buffer], name, { type: "application/vnd.ms-outlook" });
}

/** windows-1252 encoding for MAPI PT_STRING8 string properties. */
export function latin1(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index) & 0xff;
  }
  return bytes;
}

/** Stream name for PR_INTERNET_MESSAGE_ID_A (MAPI tag 0x1035, PT_STRING8). */
export const INTERNET_MESSAGE_ID_ANSI_STREAM_NAME = "__substg1.0_1035001E";

/**
 * Builds a `.msg` CFB blob that stores its Message-ID in the ANSI
 * (PT_STRING8) property stream instead of the Unicode one. A writer picks one
 * encoding for all string properties, so both variants must resolve.
 */
export function buildAnsiMsgWithInternetMessageId(
  messageId: string,
): Uint8Array {
  return buildCfbWith([
    { name: INTERNET_MESSAGE_ID_ANSI_STREAM_NAME, content: latin1(messageId) },
  ]);
}

/** One 16-byte `__properties_version1.0` entry: tag, flags, then an 8-byte value. */
function propertyEntry(tagHex: string, value: Uint8Array): Uint8Array {
  const entry = new Uint8Array(16);
  const tag = Number.parseInt(tagHex, 16);
  for (let i = 0; i < 4; i += 1) entry[i] = (tag >>> (i * 8)) & 0xff;
  entry.set(value.subarray(0, 8), 8);
  return entry;
}

function int32Value(value: number): Uint8Array {
  const out = new Uint8Array(8);
  for (let i = 0; i < 4; i += 1) out[i] = (value >>> (i * 8)) & 0xff;
  return out;
}

/** FILETIME: 100ns ticks since 1601-01-01 UTC. */
function fileTimeValue(date: Date): Uint8Array {
  const ticks = (date.getTime() + 11644473600000) * 10000;
  const out = new Uint8Array(8);
  let high = Math.floor(ticks / 4294967296);
  let low = ticks - high * 4294967296;
  for (let i = 0; i < 4; i += 1) {
    out[i] = low & 0xff;
    low = Math.floor(low / 256);
  }
  for (let i = 4; i < 8; i += 1) {
    out[i] = high & 0xff;
    high = Math.floor(high / 256);
  }
  return out;
}

function propertiesStream(
  headerSize: number,
  entries: Uint8Array[],
): Uint8Array {
  const out = new Uint8Array(headerSize + entries.length * 16);
  entries.forEach((entry, index) => out.set(entry, headerSize + index * 16));
  return out;
}

export interface RichMsgOptions {
  /** `unicode` writes PT_UNICODE (001F) streams, `ansi` writes PT_STRING8 (001E). */
  encoding: "unicode" | "ansi";
  /**
   * PidTagMessageCodepage. Real files always carry one; set it together with a
   * matching `encodeAnsi` to exercise decoding of a specific code page.
   */
  codepage?: number;
  /** Byte encoder for PT_STRING8 streams. Defaults to latin1. */
  encodeAnsi?: (value: string) => Uint8Array;
  messageId?: string;
  subject?: string;
  body?: string;
  senderName?: string;
  senderAddress?: string;
  to?: { name: string; address: string }[];
  cc?: { name: string; address: string }[];
  bcc?: { name: string; address: string }[];
  sentAt?: Date;
  attachments?: { filename: string; mimeType: string; content: Uint8Array }[];
}

/**
 * A `.msg` carrying the properties the local reader consumes, in either
 * encoding. Mirrors the layout real Outlook output uses: string properties as
 * `__substg1.0_<TAG><TYPE>` streams, fixed-width ones inline in
 * `__properties_version1.0`, recipients and attachments as numbered storages.
 */
export function buildRichMsg(options: RichMsgOptions): Uint8Array {
  const unicode = options.encoding === "unicode";
  const suffix = unicode ? "001F" : "001E";
  const encode = unicode ? utf16le : (options.encodeAnsi ?? latin1);
  const entries: { name: string; content: Uint8Array }[] = [];

  const addString = (storage: string, tag: string, value?: string) => {
    if (value === undefined) return;
    entries.push({
      name: `${storage}__substg1.0_${tag}${suffix}`,
      content: encode(value),
    });
  };

  addString("/", "1035", options.messageId);
  addString("/", "0037", options.subject);
  addString("/", "1000", options.body);
  addString("/", "0C1A", options.senderName);
  addString("/", "5D01", options.senderAddress);

  const rootProperties: Uint8Array[] = [];
  if (options.sentAt) {
    rootProperties.push(
      propertyEntry("00390040", fileTimeValue(options.sentAt)),
    );
  }
  if (options.codepage !== undefined) {
    rootProperties.push(
      propertyEntry("3FFD0003", int32Value(options.codepage)),
    );
  }
  // PidTagStoreSupportMask with STORE_UNICODE_OK, as real writers emit it. The
  // parser deliberately dispatches on the stream-name suffix instead, so this
  // is present for fidelity, not because anything reads it.
  rootProperties.push(
    propertyEntry("340D0003", int32Value(unicode ? 0x00040000 : 0)),
  );
  entries.push({
    name: "/__properties_version1.0",
    content: propertiesStream(32, rootProperties),
  });

  const recipients: {
    entry: { name: string; address: string };
    type: number;
  }[] = [
    ...(options.to ?? []).map((entry) => ({ entry, type: 1 })),
    ...(options.cc ?? []).map((entry) => ({ entry, type: 2 })),
    ...(options.bcc ?? []).map((entry) => ({ entry, type: 3 })),
  ];
  recipients.forEach(({ entry, type }, index) => {
    const storage = `/__recip_version1.0_#${index.toString(16).padStart(8, "0").toUpperCase()}/`;
    addString(storage, "3001", entry.name);
    addString(storage, "39FE", entry.address);
    entries.push({
      name: `${storage}__properties_version1.0`,
      content: propertiesStream(8, [
        propertyEntry("0C150003", int32Value(type)),
      ]),
    });
  });

  (options.attachments ?? []).forEach((attachment, index) => {
    const storage = `/__attach_version1.0_#${index.toString(16).padStart(8, "0").toUpperCase()}/`;
    addString(storage, "3707", attachment.filename);
    addString(storage, "370E", attachment.mimeType);
    entries.push({
      name: `${storage}__substg1.0_37010102`,
      content: attachment.content,
    });
  });

  return buildCfbWith(entries);
}

/** windows-1251 bytes for the Cyrillic range, enough for test strings. */
export function cp1251(value: string): Uint8Array {
  const out = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0x0410 && code <= 0x044f) out[index] = code - 0x0410 + 0xc0;
    else if (code === 0x0401) out[index] = 0xa8;
    else if (code === 0x0451) out[index] = 0xb8;
    else out[index] = code & 0xff;
  }
  return out;
}

/** UTF-8 bytes, for a `.msg` whose PT_STRING8 code page is 65001. */
export function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}
