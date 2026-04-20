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
 * Returns an empty array on any recoverable failure (unreadable CFB, missing
 * Message-ID, Graph filter yields no match, network/auth failure). Failures
 * are logged via `console.warn` so the caller gets an observable signal.
 * The deliberate choice to swallow rather than throw matches how `.eml`
 * parsing handles its own failures upstream.
 */
export async function parseMsgFileToFiles(
  file: File,
  acquireGraphToken: AcquireGraphToken,
): Promise<File[]> {
  let internetMessageId: string | null;
  try {
    internetMessageId = await extractMsgInternetMessageId(file);
  } catch (error) {
    console.warn(
      "[parseMsgFile] Failed to read CFB from dropped .msg:",
      file.name,
      error,
    );
    return [];
  }

  if (!internetMessageId) {
    console.warn(
      "[parseMsgFile] Dropped .msg has no Internet Message-ID — cannot resolve via Graph:",
      file.name,
    );
    return [];
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
      return [];
    }
    return result.files;
  } catch (error) {
    console.warn(
      "[parseMsgFile] Graph fetch failed for dropped .msg:",
      file.name,
      error,
    );
    return [];
  }
}
