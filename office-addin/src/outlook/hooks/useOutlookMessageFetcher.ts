import { useDesktopSidecar } from "@erato/frontend/library";
import { useMemo } from "react";

import { useSessionAuth } from "../../core/SessionAuthProvider";
import { detectExchangeOnPrem } from "../../utils/detectExchangeOnPrem";
import { useGraphTokenOptional } from "../providers/EntraGraphTokenProvider";
import { useOutlookMailItem } from "../providers/OutlookMailItemProvider";
import {
  createEwsOutlookMessageFetcher,
  createGraphOutlookMessageFetcher,
} from "../utils/fetchOutlookMessage";
import { createSidecarOutlookMessageFetcher } from "../utils/fetchOutlookMessageSidecar";

import type { OutlookMessageFetcher } from "../utils/fetchOutlookMessage";

export type OutlookMessageFetcherUnavailableReason =
  /** Mailbox is cloud-served but the Graph token context isn't mounted. */
  | "graph-unavailable"
  /** Which store the item lives in isn't known yet — see below. */
  | "mailbox-location-pending"
  /** On-prem mailbox, item out of a shared or delegated store — see below. */
  | "shared-mailbox-unsupported"
  /** Not authenticated (mode isn't `entra-msal`) — no mail backend applies. */
  | "unsupported-mode";

export interface UseOutlookMessageFetcherResult {
  /**
   * Mailbox the returned fetcher is bound to: the shared or delegated store's
   * address for an item that lives there, `null` for the signed-in user's own
   * store — and `null` whenever there is no fetcher. Consumers that cache by
   * item must key on it: an item's ids do not change when its store does.
   */
  mailboxRoot: string | null;
  fetcher: OutlookMessageFetcher | null;
  /**
   * Backend for the signed-in user's OWN store, whatever the selected item's
   * provenance: the same object as `fetcher` when that is already own-rooted,
   * a `/me`-rooted Graph fetcher beside a shared-rooted one, and the
   * EWS/sidecar fetcher on-prem even while `fetcher` is withheld for a shared
   * item. For operands that belong to the user's own mailbox — a row dragged
   * from their inbox, a dropped `.msg` — never for the selected item. Null
   * whenever no backend applies at all (auth mode, missing Graph, probe
   * pending).
   */
  ownMailboxFetcher: OutlookMessageFetcher | null;
  unavailableReason: OutlookMessageFetcherUnavailableReason | null;
}

/**
 * Selects the message-fetch backend by gating on auth first, then on where the
 * mailbox lives (see `fetchOutlookMessage.ts` for why the two backends are
 * mutually exclusive). Both Entra sources authenticate as `entra-msal`, so the
 * backend can no longer be chosen by auth mode — it follows the mailbox:
 *
 *   - not authenticated (mode !== `entra-msal`) → `fetcher: null` +
 *     `unsupported-mode`.
 *   - the shared-mailbox probe still in flight → `fetcher: null` +
 *     `mailbox-location-pending`. The item resolves synchronously but its
 *     provenance does not, so on the first render(s) "not shared" and "not
 *     known yet" are the same value. Handing out a `/me`-rooted fetcher in
 *     that window is not a glitch that later self-corrects: `useCurrentThread`
 *     keys its query on the item ids alone with `staleTime: Infinity`, so the
 *     empty answer for a conversation living in someone else's store gets
 *     cached and is never refetched once the owner arrives. Consumers must
 *     render this reason as LOADING, never as "no backend": the composer's
 *     send gate keys on the thread being in flight.
 *   - on-prem mailbox, item out of a shared or delegated store →
 *     `fetcher: null` + `shared-mailbox-unsupported`. Microsoft does not
 *     support EWS in shared folder and shared mailbox scenarios, and Graph is
 *     not an option on-prem at all, so no backend can read the item: an EWS
 *     fetch SUCCEEDS there but answers out of the delegate's own mailbox, and
 *     refusing beats handing consumers confidently wrong mail.
 *   - on-prem mailbox (`detectExchangeOnPrem`) → direct EWS SOAP fetcher;
 *     Graph can't reach on-prem mailboxes, so it reads mail via the Exchange
 *     callback token (acquired per operation from the Office host, no React
 *     context needed).
 *   - cloud mailbox (EXO) with the Graph token context mounted → Graph
 *     fetcher rooted at the store the item lives in, handed the raw scoped
 *     acquirer (`forceRefresh` passes through for the fetch layer's
 *     401-retry). The factory derives the scope from that root — `Mail.Read`
 *     for `/me`, `Mail.Read.Shared` for `/users/{owner}` — so no caller can
 *     pair an owner with the narrow scope.
 *   - cloud mailbox without the Graph context → `fetcher: null` +
 *     `graph-unavailable`.
 *
 * NEVER throws — the pre-seam `useGraphToken()` threw on non-Graph hosts, which
 * took the whole tree down the moment a non-Graph session authenticated.
 *
 * Consumers must degrade gracefully when `fetcher` is null: skip the email
 * features that need a backend fetch (mail-list drops, `.msg` resolution,
 * thread synthesis, reply context); local `.eml` parsing keeps working.
 */
export function useOutlookMessageFetcher(): UseOutlookMessageFetcherResult {
  const { mode } = useSessionAuth();
  const graph = useGraphTokenOptional();
  // The mailbox host can't change within a session, so the probe is stable —
  // compute it once and feed the stable value into the dispatch memo.
  const isOnPrem = useMemo(() => detectExchangeOnPrem(), []);
  // The desktop sidecar augments only the on-prem/SE conversation path.
  const { client: sidecarClient } = useDesktopSidecar();
  const { mailItem, sharedContext, isLoadingSharedContext } =
    useOutlookMailItem();
  const anchorInternetMessageId = mailItem?.internetMessageId ?? null;
  // Depend on the address, not the context object: the provider mints a fresh
  // object on every selection event (hosts fire two for a single selection),
  // which would otherwise change the fetcher's identity — and restart every
  // effect keyed on it — for a byte-identical owner.
  const sharedMailboxRoot = sharedContext
    ? (sharedContext.targetMailbox ?? sharedContext.owner)
    : null;

  return useMemo<UseOutlookMessageFetcherResult>(() => {
    if (mode !== "entra-msal") {
      return {
        fetcher: null,
        ownMailboxFetcher: null,
        mailboxRoot: null,
        unavailableReason: "unsupported-mode",
      };
    }
    if (isLoadingSharedContext) {
      return {
        fetcher: null,
        ownMailboxFetcher: null,
        mailboxRoot: null,
        unavailableReason: "mailbox-location-pending",
      };
    }
    if (isOnPrem) {
      const ews = createEwsOutlookMessageFetcher();
      const ownMailboxFetcher = sidecarClient
        ? createSidecarOutlookMessageFetcher({
            inner: ews,
            client: sidecarClient,
            anchorInternetMessageId,
            userEmailAddress:
              Office.context?.mailbox?.userProfile?.emailAddress ?? null,
          })
        : ews;
      if (sharedMailboxRoot) {
        // The selected item is out of reach, but the user's own store is not:
        // rows dragged from their inbox and dropped `.msg` files still read.
        return {
          fetcher: null,
          ownMailboxFetcher,
          mailboxRoot: null,
          unavailableReason: "shared-mailbox-unsupported",
        };
      }
      return {
        fetcher: ownMailboxFetcher,
        ownMailboxFetcher,
        mailboxRoot: null,
        unavailableReason: null,
      };
    }
    if (!graph) {
      return {
        fetcher: null,
        ownMailboxFetcher: null,
        mailboxRoot: null,
        unavailableReason: "graph-unavailable",
      };
    }
    const ownMailboxFetcher = createGraphOutlookMessageFetcher(
      graph.acquireToken,
      { owner: null },
    );
    return {
      fetcher: sharedMailboxRoot
        ? createGraphOutlookMessageFetcher(graph.acquireToken, {
            owner: sharedMailboxRoot,
          })
        : ownMailboxFetcher,
      ownMailboxFetcher,
      mailboxRoot: sharedMailboxRoot,
      unavailableReason: null,
    };
  }, [
    graph,
    mode,
    isOnPrem,
    sidecarClient,
    anchorInternetMessageId,
    sharedMailboxRoot,
    isLoadingSharedContext,
  ]);
}
