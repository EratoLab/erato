import * as CFB from "cfb";

/**
 * Reads ONLY the PR_INTERNET_MESSAGE_ID stream (MAPI tag 0x1035) from a
 * `.msg` Compound File Binary Format blob. Deliberately avoids full MSG
 * semantics — all we need is the RFC 5322 `Message-ID` so we can look the
 * message up via the environment's mail backend.
 *
 * MAPI stream naming convention: each string property is stored in a stream
 * named `__substg1.0_<TAG>`, where `<TAG>` is the 4-byte property tag in
 * uppercase hex. The low two bytes are the property TYPE, so the same
 * property appears under two different names depending on how the writer
 * encoded it: `001F` = PT_UNICODE (UTF-16LE), `001E` = PT_STRING8. Outlook
 * writes one or the other, never both, so reading only the Unicode name
 * silently yields nothing for a PT_STRING8 file.
 *
 * PT_STRING8 is nominally in the code page named by PR_INTERNET_CPID; we
 * decode windows-1252 unconditionally because RFC 5322 restricts msg-id to
 * printable US-ASCII, which every candidate code page agrees on.
 */

const UNICODE_STREAM_PATH = "/__substg1.0_1035001F";
const ANSI_STREAM_PATH = "/__substg1.0_1035001E";

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

  return (
    readStream(container, UNICODE_STREAM_PATH, "utf-16le") ??
    readStream(container, ANSI_STREAM_PATH, "windows-1252")
  );
}

/**
 * `path` must stay root-anchored: `CFB.find` resolves a bare name against
 * every leaf in the tree, so an embedded forwarded message's copy of the
 * property would otherwise shadow the carrier's own.
 */
function readStream(
  container: CFB.CFB$Container,
  path: string,
  encoding: string,
): string | null {
  const entry = CFB.find(container, path);
  if (!entry) {
    return null;
  }

  const content = entry.content;
  const streamBytes =
    content instanceof Uint8Array ? content : new Uint8Array(content);
  if (streamBytes.length === 0) {
    return null;
  }

  const decoded = new TextDecoder(encoding).decode(streamBytes);
  const trimmed = decoded.replace(/\0+$/u, "").trim();
  return trimmed.length > 0 ? trimmed : null;
}
