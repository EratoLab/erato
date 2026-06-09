import { extractMsgInternetMessageId } from "./extractMsgInternetMessageId";
import {
  fetchOutlookMessageBytesByInternetMessageIdViaGraph,
  fetchOutlookMessageFilesByInternetMessageIdViaGraph,
} from "./fetchOutlookMessageGraph";
import {
  OUTLOOK_GRAPH_MESSAGE_TIMEOUT_MS,
  runWithGraphTimeout,
} from "./graphRequestTimeout";
import { parseEmlBytes } from "./parsedEmail";

import type { AcquireGraphToken } from "./fetchOutlookMessageGraph";
import type { ParsedEmail } from "./parsedEmail";

/**
 * Resolves a dropped `.msg` file into the same body + attachment File[] shape
 * our other paths produce. Strategy: extract only the RFC 5322 `Message-ID`
 * from the CFB, then look the message up via Microsoft Graph with a
 * `Mail.Read` token. We never parse the binary body / attachments locally —
 * Graph owns the fidelity-sensitive work (RTF-encapsulated HTML, embedded
 * content types, etc.).
 *
 * Returns an empty file list on any recoverable failure (unreadable CFB,
 * missing Message-ID, Graph filter yields no match, network/auth failure).
 * The extracted `messageId` (if any) is still surfaced so callers can apply
 * de-duplication against other representations of the same email.
 */
export interface MsgParseResult {
  files: File[];
  messageId: string | null;
}

export async function parseMsgFileToFiles(
  file: File,
  acquireGraphToken: AcquireGraphToken,
): Promise<MsgParseResult> {
  const internetMessageId = await extractMessageIdSafely(file);
  if (!internetMessageId) {
    return { files: [], messageId: null };
  }

  try {
    const result = await runWithGraphTimeout(
      OUTLOOK_GRAPH_MESSAGE_TIMEOUT_MS,
      `Outlook .msg fetch timed out after ${OUTLOOK_GRAPH_MESSAGE_TIMEOUT_MS}ms`,
      undefined,
      (signal) =>
        fetchOutlookMessageFilesByInternetMessageIdViaGraph(
          internetMessageId,
          acquireGraphToken,
          { signal },
        ),
    );
    if (!result) {
      console.warn(
        "[parseMsgFile] Graph lookup returned no match for Message-ID:",
        internetMessageId,
      );
      return { files: [], messageId: internetMessageId };
    }
    return { files: result.files, messageId: internetMessageId };
  } catch (error) {
    console.warn(
      "[parseMsgFile] Graph fetch failed for dropped .msg:",
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

export async function parseMsgFileToParsedEmail(
  file: File,
  acquireGraphToken: AcquireGraphToken,
): Promise<MsgParsedResult> {
  const internetMessageId = await extractMessageIdSafely(file);
  if (!internetMessageId) {
    return { parsed: null, messageId: null };
  }

  let bytesResult;
  try {
    bytesResult = await runWithGraphTimeout(
      OUTLOOK_GRAPH_MESSAGE_TIMEOUT_MS,
      `Outlook .msg fetch timed out after ${OUTLOOK_GRAPH_MESSAGE_TIMEOUT_MS}ms`,
      undefined,
      (signal) =>
        fetchOutlookMessageBytesByInternetMessageIdViaGraph(
          internetMessageId,
          acquireGraphToken,
          { signal },
        ),
    );
  } catch (error) {
    console.warn(
      "[parseMsgFile] Graph fetch failed for dropped .msg:",
      file.name,
      error,
    );
    return { parsed: null, messageId: internetMessageId };
  }

  if (!bytesResult) {
    console.warn(
      "[parseMsgFile] Graph lookup returned no match for Message-ID:",
      internetMessageId,
    );
    return { parsed: null, messageId: internetMessageId };
  }

  const parsed = await parseEmlBytes(bytesResult.bytes);
  return {
    parsed,
    messageId: parsed?.messageId ?? internetMessageId,
  };
}

async function extractMessageIdSafely(file: File): Promise<string | null> {
  try {
    return await extractMsgInternetMessageId(file);
  } catch (error) {
    console.warn(
      "[parseMsgFile] Failed to read CFB from dropped .msg:",
      file.name,
      error,
    );
    return null;
  }
}
