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
