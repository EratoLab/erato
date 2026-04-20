import * as CFB from "cfb";

/**
 * Reads ONLY the PR_INTERNET_MESSAGE_ID stream (MAPI tag 0x1035, type PT_UNICODE)
 * from a `.msg` Compound File Binary Format blob. Deliberately avoids full
 * MSG semantics — all we need is the RFC 5322 `Message-ID` so we can look
 * the message up via Microsoft Graph.
 *
 * MAPI stream naming convention: each string property is stored in a stream
 * named `__substg1.0_<TAG>`, where `<TAG>` is the 4-byte property tag in
 * uppercase hex. PR_INTERNET_MESSAGE_ID_W = 0x1035001F.
 */

const INTERNET_MESSAGE_ID_STREAM_NAME = "__substg1.0_1035001F";

export async function extractMsgInternetMessageId(
  file: File,
): Promise<string | null> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  return extractMsgInternetMessageIdFromBytes(buffer);
}

export function extractMsgInternetMessageIdFromBytes(
  bytes: Uint8Array,
): string | null {
  let container;
  try {
    container = CFB.read(bytes, { type: "array" });
  } catch {
    return null;
  }

  const entry = CFB.find(container, INTERNET_MESSAGE_ID_STREAM_NAME);
  if (!entry) {
    return null;
  }

  const content = entry.content;
  const streamBytes =
    content instanceof Uint8Array ? content : new Uint8Array(content);
  if (streamBytes.length === 0) {
    return null;
  }

  const decoded = new TextDecoder("utf-16le").decode(streamBytes);
  const trimmed = decoded.replace(/\0+$/u, "").trim();
  return trimmed.length > 0 ? trimmed : null;
}
