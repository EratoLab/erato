import { useMemo } from "react";

import { useGraphTokenOptional } from "../providers/EntraGraphTokenProvider";
import { useSessionAuth } from "../providers/SessionAuthProvider";
import { detectExchangeOnPrem } from "../utils/detectExchangeOnPrem";
import {
  createGraphOutlookMessageFetcher,
  createRestV2OutlookMessageFetcher,
} from "../utils/fetchOutlookMessage";

import type { OutlookMessageFetcher } from "../utils/fetchOutlookMessage";
import type { AcquireGraphToken } from "../utils/fetchOutlookMessageGraph";

const GRAPH_MAIL_SCOPES = ["Mail.Read"];

export type OutlookMessageFetcherUnavailableReason =
  /** Mailbox is cloud-served but the Graph token context isn't mounted. */
  | "graph-unavailable"
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
 *   - on-prem mailbox (`detectExchangeOnPrem`) → Outlook REST v2.0 fetcher;
 *     Graph can't reach on-prem mailboxes, so it reads mail via the Exchange
 *     callback token (acquired per operation from the Office host, no React
 *     context needed).
 *   - cloud mailbox (EXO) with the Graph token context mounted → Graph fetcher,
 *     bound to a silent `Mail.Read` acquirer (`forceRefresh` passes through for
 *     the fetch layer's 401-retry).
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

  return useMemo<UseOutlookMessageFetcherResult>(() => {
    if (mode !== "entra-msal") {
      return { fetcher: null, unavailableReason: "unsupported-mode" };
    }
    if (isOnPrem) {
      return {
        fetcher: createRestV2OutlookMessageFetcher(),
        unavailableReason: null,
      };
    }
    if (!graph) {
      return { fetcher: null, unavailableReason: "graph-unavailable" };
    }
    const acquireGraphToken: AcquireGraphToken = (options) =>
      graph.acquireToken(GRAPH_MAIL_SCOPES, options);
    return {
      fetcher: createGraphOutlookMessageFetcher(acquireGraphToken),
      unavailableReason: null,
    };
  }, [graph, mode, isOnPrem]);
}
