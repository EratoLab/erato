import type { OutlookMessageFetcher } from "./fetchOutlookMessage";
import type { OutlookMailListDragItem } from "./outlookMailListDragParse";

export interface MailListRowBackends {
  /** Backend bound to the SELECTED item's store; null while withheld. */
  bound: OutlookMessageFetcher | null;
  /** Backend for the signed-in user's own store. */
  own: OutlookMessageFetcher | null;
  /**
   * Addresses the selected item's store is known under (owner and, when the
   * host reports one, target mailbox). Empty when the selected item sits in
   * the user's own mailbox.
   */
  boundMailboxAddresses: readonly string[];
}

/**
 * Picks the backend a dragged mail-list row must be read through.
 *
 * The bound backend addresses the SELECTED item's store, but a row can be
 * dragged out of any store the user has open, and a message id resolves only
 * in the store it belongs to. Rows are matched against the bound store's
 * addresses, never the profile address: that one is known to flip to the
 * shared mailbox in some OWA modes.
 *
 *   - Nothing bound to a foreign store → the own backend, for every row: the
 *     route that predates shared-mailbox support. A row from a shared mailbox
 *     404s there, loudly.
 *   - Row out of the bound store → the bound backend. Null when that backend
 *     is withheld (on-prem), so the caller skips rather than reads the wrong
 *     store.
 *   - Row out of any other store → the own backend.
 *   - Row without a mailbox → the bound backend; its provenance is unknown and
 *     that is today's route.
 */
export function resolveMailListRowFetcher(
  item: Pick<OutlookMailListDragItem, "mailboxSmtpAddress">,
  backends: MailListRowBackends,
): OutlookMessageFetcher | null {
  if (backends.boundMailboxAddresses.length === 0) {
    return backends.own ?? backends.bound;
  }
  const rowMailbox = item.mailboxSmtpAddress.trim().toLowerCase();
  if (!rowMailbox) {
    return backends.bound;
  }
  const fromBoundStore = backends.boundMailboxAddresses.some(
    (address) => address.trim().toLowerCase() === rowMailbox,
  );
  return fromBoundStore ? backends.bound : backends.own;
}
