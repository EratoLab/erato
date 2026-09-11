import { extractMsgInternetMessageIdFromBytes } from "./extractMsgInternetMessageId";
import {
  OUTLOOK_GRAPH_MESSAGE_TIMEOUT_MS,
  runWithGraphTimeout,
} from "./graphRequestTimeout";
import { parseMsgLocallyToEml } from "./parseMsgLocally";
import { parseEmlBytes } from "./parsedEmail";

import type { OutlookMessageFetcher } from "./fetchOutlookMessage";
import type { ParsedEmail } from "./parsedEmail";

/**
 * Resolves a dropped `.msg` file into the same body + attachment File[] shape
 * our other paths produce. Strategy: extract only the RFC 5322 `Message-ID`
 * from the CFB, then look the message up through the environment's message
 * fetcher (Graph on Exchange Online, EWS SOAP on-prem). We never
 * parse the binary body / attachments locally — the mail backend owns the
 * fidelity-sensitive work (RTF-encapsulated HTML, embedded content types,
 * etc.).
 *
 * Returns an empty file list on any recoverable failure (unreadable CFB,
 * missing Message-ID, the lookup yields no match, network/auth failure).
 * The extracted `messageId` (if any) is still surfaced so callers can apply
 * de-duplication against other representations of the same email.
 */
export interface MsgParseResult {
  files: File[];
  messageId: string | null;
}

export async function parseMsgFileToFiles(
  file: File,
  fetcher: OutlookMessageFetcher,
): Promise<MsgParseResult> {
  const bytes = await readBytesSafely(file);
  const internetMessageId = bytes
    ? extractMessageIdSafely(bytes, file.name)
    : null;
  if (!internetMessageId) {
    return { files: [], messageId: null };
  }

  try {
    const result = await runWithGraphTimeout(
      OUTLOOK_GRAPH_MESSAGE_TIMEOUT_MS,
      `Outlook .msg fetch timed out after ${OUTLOOK_GRAPH_MESSAGE_TIMEOUT_MS}ms`,
      undefined,
      (signal) =>
        fetcher.fetchMessageFilesByInternetMessageId(internetMessageId, {
          signal,
        }),
    );
    if (!result) {
      console.warn(
        "[parseMsgFile] lookup returned no match for Message-ID:",
        internetMessageId,
      );
      return { files: [], messageId: internetMessageId };
    }
    return { files: result.files, messageId: internetMessageId };
  } catch (error) {
    console.warn(
      "[parseMsgFile] message fetch failed for dropped .msg:",
      file.name,
      error,
    );
    return { files: [], messageId: internetMessageId };
  }
}

export interface MsgParsedResult {
  parsed: ParsedEmail | null;
  messageId: string | null;
}

/** The local half of a `.msg` drop: the bytes plus the `Message-ID` they carry. */
export interface MsgRead {
  bytes: Uint8Array;
  internetMessageId: string | null;
}

export async function parseMsgFileToParsedEmail(
  file: File,
  fetcher: OutlookMessageFetcher,
): Promise<MsgParsedResult> {
  const read = await readMsgFile(file);
  if (!read) {
    return { parsed: null, messageId: null };
  }
  return resolveMsgRead(read, fetcher, file.name);
}

/**
 * Reads the file and extracts only its `Message-ID`; no network. Returns null
 * when the bytes cannot be read at all.
 */
export async function readMsgFile(file: File): Promise<MsgRead | null> {
  const bytes = await readBytesSafely(file);
  if (!bytes) {
    return null;
  }
  return { bytes, internetMessageId: extractMessageIdSafely(bytes, file.name) };
}

/**
 * Turns a local read into a ParsedEmail. The backend copy is preferred
 * whenever it can be had: it owns the fidelity-sensitive work
 * (RTF-encapsulated HTML, embedded content types) that the local reader
 * deliberately skips. With no Message-ID, no match, or a failed fetch, the
 * file itself still describes the message well enough to attach. Never
 * rejects.
 */
export async function resolveMsgRead(
  { bytes, internetMessageId }: MsgRead,
  fetcher: OutlookMessageFetcher,
  sourceName: string,
): Promise<MsgParsedResult> {
  if (internetMessageId) {
    const fetched = await fetchParsedEmail(fetcher, internetMessageId);
    if (fetched) {
      return {
        parsed: fetched,
        messageId: fetched.messageId ?? internetMessageId,
      };
    }
  }

  const parsed = await parseMsgBytesLocally(bytes, sourceName);
  if (!parsed) {
    console.warn(
      "[parseMsgFile] could not resolve or read dropped .msg:",
      sourceName,
    );
  }
  return { parsed, messageId: parsed?.messageId ?? internetMessageId };
}

async function fetchParsedEmail(
  fetcher: OutlookMessageFetcher,
  internetMessageId: string,
): Promise<ParsedEmail | null> {
  let bytesResult;
  try {
    bytesResult = await runWithGraphTimeout(
      OUTLOOK_GRAPH_MESSAGE_TIMEOUT_MS,
      `Outlook .msg fetch timed out after ${OUTLOOK_GRAPH_MESSAGE_TIMEOUT_MS}ms`,
      undefined,
      (signal) =>
        fetcher.fetchMessageBytesByInternetMessageId(internetMessageId, {
          signal,
        }),
    );
  } catch {
    return null;
  }
  if (!bytesResult) {
    return null;
  }
  return parseEmlBytes(bytesResult.bytes);
}

async function parseMsgBytesLocally(
  bytes: Uint8Array,
  sourceName: string,
): Promise<ParsedEmail | null> {
  const filename = sourceName.replace(/\.msg$/i, "") + ".eml";
  const eml = parseMsgLocallyToEml(bytes, { filename });
  if (!eml) return null;
  return parseEmlBytes(await eml.arrayBuffer(), { filename });
}

async function readBytesSafely(file: File): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await file.arrayBuffer());
  } catch (error) {
    console.warn(
      "[parseMsgFile] could not read dropped .msg:",
      file.name,
      error,
    );
    return null;
  }
}

function extractMessageIdSafely(
  bytes: Uint8Array,
  sourceName: string,
): string | null {
  try {
    return extractMsgInternetMessageIdFromBytes(bytes);
  } catch (error) {
    console.warn(
      "[parseMsgFile] Failed to read CFB from dropped .msg:",
      sourceName,
      error,
    );
    return null;
  }
}
