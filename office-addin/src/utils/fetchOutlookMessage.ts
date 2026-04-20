import { fetchOutlookMessageFilesViaGraph } from "./fetchOutlookMessageGraph";

import type {
  AcquireGraphToken,
  FetchOutlookMessageResult,
} from "./fetchOutlookMessageGraph";

/**
 * Public entry point for fetching an Outlook message's body and attachments
 * by EWS item id. Dispatches to the right backend implementation for the
 * current environment.
 *
 * Today the dispatcher always routes to Microsoft Graph — see
 * `./fetchOutlookMessageGraph.ts`. The Exchange on-premises path, which uses
 * the legacy callback-token + Outlook REST v2.0 surface, is preserved in
 * `./fetchOutlookMessageRestV2.ts` and will be re-wired here when on-prem
 * mailbox support is brought back.
 */

export type { AcquireGraphToken, FetchOutlookMessageResult };

export async function fetchOutlookMessageFiles(
  ewsItemId: string,
  acquireGraphToken: AcquireGraphToken,
): Promise<FetchOutlookMessageResult> {
  return fetchOutlookMessageFilesViaGraph(ewsItemId, acquireGraphToken);
}
