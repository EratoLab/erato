import { fetchOutlookMessageFilesViaGraph } from "./fetchOutlookMessageGraph";

import type { AcquireGraphToken } from "./fetchOutlookMessageGraph";

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
