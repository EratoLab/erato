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
import type { AcquireGraphToken } from "../utils/fetchOutlookMessageGraph";

const GRAPH_MAIL_SCOPES = ["Mail.Read"];
/**
 * Reading a mailbox that isn't the signed-in user's own needs its OWN scope:
 * Entra consent has no hierarchy, so a granted `Mail.Read` does not authorise
 * `/users/{owner}` and Graph answers 403 there. Kept separate from
 * {@link GRAPH_MAIL_SCOPES} rather than merged into it — this is requested
 * only for an item that actually came out of a shared or delegated mailbox,
 * so the common path keeps asking for the narrow scope.
 */
const GRAPH_SHARED_MAIL_SCOPES = ["Mail.Read.Shared"];

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
  fetcher: OutlookMessageFetcher | null;
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
 *     cached and is never refetched once the owner arrives.
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
 *     fetcher, bound to a silent acquirer (`forceRefresh` passes through for
 *     the fetch layer's 401-retry) and rooted at the store the item lives in:
 *     `Mail.Read` against `/me` for the user's own mailbox, the wider
 *     `Mail.Read.Shared` against `/users/{owner}` for a shared or delegated
 *     one.
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
      return { fetcher: null, unavailableReason: "unsupported-mode" };
    }
    if (isLoadingSharedContext) {
      return { fetcher: null, unavailableReason: "mailbox-location-pending" };
    }
    if (isOnPrem) {
      if (sharedMailboxRoot) {
        return {
          fetcher: null,
          unavailableReason: "shared-mailbox-unsupported",
        };
      }
      const ews = createEwsOutlookMessageFetcher();
      const fetcher = sidecarClient
        ? createSidecarOutlookMessageFetcher({
            inner: ews,
            client: sidecarClient,
            anchorInternetMessageId,
            userEmailAddress:
              Office.context?.mailbox?.userProfile?.emailAddress ?? null,
          })
        : ews;
      return { fetcher, unavailableReason: null };
    }
    if (!graph) {
      return { fetcher: null, unavailableReason: "graph-unavailable" };
    }
    const acquireGraphToken: AcquireGraphToken = (options) =>
      graph.acquireToken(
        sharedMailboxRoot ? GRAPH_SHARED_MAIL_SCOPES : GRAPH_MAIL_SCOPES,
        options,
      );
    return {
      fetcher: createGraphOutlookMessageFetcher(acquireGraphToken, {
        owner: sharedMailboxRoot,
      }),
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
