import {
  fetchOutlookMessageBytesViaGraph,
  fetchOutlookMessageFilesViaGraph,
} from "./fetchOutlookMessageGraph";
import { parseEmlBytes } from "./parsedEmail";

import type { AcquireGraphToken } from "./fetchOutlookMessageGraph";
import type { ParsedEmail } from "./parsedEmail";

/**
 * Fetches the currently-open Outlook message as a raw `.eml` File
 * (`message/rfc822`) via Microsoft Graph. The returned file is what the
 * "Add email content" accessory uploads; the backend extracts headers and
 * body server-side via Kreuzberg.
 *
 * Graph can only serve messages that are indexed — drafts/compose items
 * without an EWS `itemId` aren't reachable this way, so callers should only
 * invoke this when `mailItem.itemId` is non-null.
 *
 * Returns `null` on any recoverable failure (network error, 404 on a
 * just-sent message still being indexed, etc.) so the accessory can surface
 * a non-fatal error state without blocking the rest of the composer.
 */
export interface CurrentEmailEmlResult {
  file: File;
  messageId: string | null;
}

export async function fetchCurrentEmailEml(
  itemId: string,
  acquireGraphToken: AcquireGraphToken,
): Promise<CurrentEmailEmlResult | null> {
  try {
    const result = await fetchOutlookMessageFilesViaGraph(
      itemId,
      acquireGraphToken,
    );
    const file = result.files[0];
    if (!file) {
      return null;
    }
    return { file, messageId: result.internetMessageId };
  } catch (error) {
    console.warn(
      "[fetchCurrentEmailEml] Graph fetch failed for current email:",
      error,
    );
    return null;
  }
}

export interface CurrentEmailParsedResult {
  parsed: ParsedEmail;
  /**
   * Dedup key. Prefers postal-mime's parsed `Message-ID` (canonical RFC 5322
   * source of truth) and falls back to Graph's `internetMessageId` field —
   * which can differ in bracket presence for some legacy Exchange mailboxes.
   */
  messageId: string | null;
}

export async function fetchCurrentEmailParsed(
  itemId: string,
  acquireGraphToken: AcquireGraphToken,
): Promise<CurrentEmailParsedResult | null> {
  let bytesResult;
  try {
    bytesResult = await fetchOutlookMessageBytesViaGraph(
      itemId,
      acquireGraphToken,
    );
  } catch (error) {
    console.warn(
      "[fetchCurrentEmailParsed] Graph fetch failed for current email:",
      error,
    );
    return null;
  }

  const parsed = await parseEmlBytes(bytesResult.bytes);
  if (!parsed) {
    return null;
  }
  return {
    parsed,
    messageId: parsed.messageId ?? bytesResult.internetMessageId,
  };
}
