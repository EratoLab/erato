import { parseEmlBytes } from "./parsedEmail";

import type { OutlookMessageFetcher } from "./fetchOutlookMessage";
import type { ParsedEmail } from "./parsedEmail";

/**
 * Fetches and parses the currently-open Outlook message via the environment's
 * message fetcher (Graph on Exchange Online, EWS SOAP on-prem; see
 * `fetchOutlookMessage.ts`).
 *
 * Both backends can only serve messages that are indexed — drafts/compose
 * items without an EWS `itemId` aren't reachable this way, so callers should
 * only invoke this when `mailItem.itemId` is non-null.
 *
 * Returns `null` on any recoverable failure (network error, 404 on a
 * just-sent message still being indexed, parse failure) so the accessory
 * can surface a non-fatal error state without blocking the composer.
 */
export interface CurrentEmailParsedResult {
  parsed: ParsedEmail;
  /**
   * Dedup key. Prefers postal-mime's parsed `Message-ID` (canonical RFC 5322
   * source of truth) and falls back to the backend's `internetMessageId`
   * field — which can differ in bracket presence for some legacy Exchange
   * mailboxes.
   */
  messageId: string | null;
}

export async function fetchCurrentEmailParsed(
  itemId: string,
  fetcher: OutlookMessageFetcher,
): Promise<CurrentEmailParsedResult | null> {
  let bytesResult;
  try {
    bytesResult = await fetcher.fetchMessageBytes(itemId);
  } catch (error) {
    console.warn(
      "[fetchCurrentEmailParsed] message fetch failed for current email:",
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
