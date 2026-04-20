import { extractMsgInternetMessageId } from "./extractMsgInternetMessageId";
import { fetchOutlookMessageFilesByInternetMessageIdViaGraph } from "./fetchOutlookMessageGraph";

import type { AcquireGraphToken } from "./fetchOutlookMessageGraph";

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
  let internetMessageId: string | null;
  try {
    internetMessageId = await extractMsgInternetMessageId(file);
  } catch (error) {
    console.warn(
      "[parseMsgFile] Failed to read CFB from dropped .msg:",
      file.name,
      error,
    );
    return { files: [], messageId: null };
  }

  if (!internetMessageId) {
    console.warn(
      "[parseMsgFile] Dropped .msg has no Internet Message-ID — cannot resolve via Graph:",
      file.name,
    );
    return { files: [], messageId: null };
  }

  try {
    const result = await fetchOutlookMessageFilesByInternetMessageIdViaGraph(
      internetMessageId,
      acquireGraphToken,
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
