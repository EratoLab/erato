import { fetchOutlookMessageBytesViaGraph } from "./fetchOutlookMessageGraph";
import { parseEmlBytes } from "./parsedEmail";

import type { AcquireGraphToken } from "./fetchOutlookMessageGraph";
import type { ParsedEmail } from "./parsedEmail";

/**
 * Fetches and parses the currently-open Outlook message via Microsoft Graph.
 *
 * Graph can only serve messages that are indexed — drafts/compose items
 * without an EWS `itemId` aren't reachable this way, so callers should only
 * invoke this when `mailItem.itemId` is non-null.
 *
 * Returns `null` on any recoverable failure (network error, 404 on a
 * just-sent message still being indexed, parse failure) so the accessory
 * can surface a non-fatal error state without blocking the composer.
 */
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
