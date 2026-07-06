import { useMemo } from "react";

import { useGraphTokenOptional } from "../providers/EntraGraphTokenProvider";
import { useSessionAuth } from "../providers/SessionAuthProvider";
import { detectExchangeOnPrem } from "../utils/detectExchangeOnPrem";
import {
  createEwsOutlookCalendarFetcher,
  createGraphOutlookCalendarFetcher,
} from "../utils/fetchOutlookCalendar";

import type { OutlookCalendarFetcher } from "../utils/fetchOutlookCalendar";
import type { AcquireGraphToken } from "../utils/fetchOutlookMessageGraph";
import type { GraphDirectoryTokenSources } from "../utils/graphAttendeeResolution";

const GRAPH_CALENDAR_SCOPES = ["Calendars.Read"];

/**
 * OPTIONAL directory scopes for attendee display-name → SMTP resolution
 * (ERMAIN-434 name search). Deliberately NOT bundled into
 * GRAPH_CALENDAR_SCOPES: each is acquired separately and lazily, so a tenant
 * that declines them (directory search can enumerate the GAL — some orgs
 * won't allow it) loses ONLY name lookup, never the calendar read. Grant in
 * the Entra app registration to enable: People.Read (relevance search over
 * `/me/people`) and/or User.ReadBasic.All (GAL prefix search over `/users`) —
 * either alone works, both is best.
 */
const GRAPH_DIRECTORY_PEOPLE_SCOPES = ["People.Read"];
const GRAPH_DIRECTORY_USERS_SCOPES = ["User.ReadBasic.All"];

export type OutlookCalendarFetcherUnavailableReason =
  /** Mailbox is cloud-served but the Graph token context isn't mounted. */
  | "graph-unavailable"
  /** Not authenticated (mode isn't `entra-msal`) — no calendar backend applies. */
  | "unsupported-mode";

export interface UseOutlookCalendarFetcherResult {
  fetcher: OutlookCalendarFetcher | null;
  unavailableReason: OutlookCalendarFetcherUnavailableReason | null;
}

/**
 * Selects the calendar-fetch backend by gating on auth first, then on where the
 * mailbox lives (see `fetchOutlookCalendar.ts` for why the two backends are
 * mutually exclusive). Both Entra sources authenticate as `entra-msal`, so the
 * backend can no longer be chosen by auth mode — it follows the mailbox:
 *
 *   - on-prem mailbox (`detectExchangeOnPrem`) → direct EWS SOAP fetcher;
 *     Graph can't reach on-prem mailboxes, so it reads the calendar via the
 *     host-brokered EWS transport (no React context needed).
 *   - cloud mailbox (EXO) with the Graph token context mounted → Graph fetcher,
 *     bound to a silent `Calendars.Read` acquirer (`forceRefresh` passes through
 *     for the fetch layer's 401-retry).
 *
 * NEVER throws — mirrors `useOutlookMessageFetcher`; consumers must degrade
 * gracefully when `fetcher` is null by skipping calendar-backed features.
 */
export function useOutlookCalendarFetcher(): UseOutlookCalendarFetcherResult {
  const { mode } = useSessionAuth();
  const graph = useGraphTokenOptional();
  // The mailbox host can't change within a session, so the probe is stable.
  const isOnPrem = useMemo(() => detectExchangeOnPrem(), []);

  return useMemo<UseOutlookCalendarFetcherResult>(() => {
    if (mode !== "entra-msal") {
      return { fetcher: null, unavailableReason: "unsupported-mode" };
    }
    if (isOnPrem) {
      return {
        fetcher: createEwsOutlookCalendarFetcher(),
        unavailableReason: null,
      };
    }
    if (!graph) {
      return { fetcher: null, unavailableReason: "graph-unavailable" };
    }
    const acquireGraphToken: AcquireGraphToken = (options) =>
      graph.acquireToken(GRAPH_CALENDAR_SCOPES, options);
    // Both acquirers are always offered; an unconsented scope fails at
    // acquisition time inside the resolution module, which degrades that
    // lookup to "unavailable" without touching the calendar legs.
    const directory: GraphDirectoryTokenSources = {
      people: (options) =>
        graph.acquireToken(GRAPH_DIRECTORY_PEOPLE_SCOPES, options),
      users: (options) =>
        graph.acquireToken(GRAPH_DIRECTORY_USERS_SCOPES, options),
    };
    return {
      fetcher: createGraphOutlookCalendarFetcher(acquireGraphToken, directory),
      unavailableReason: null,
    };
  }, [graph, mode, isOnPrem]);
}
