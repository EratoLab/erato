import { useEffect } from "react";

import { useGraphTokenOptional } from "../providers/EntraGraphTokenProvider";

import type { AcquireGraphToken } from "../utils/fetchOutlookMessageGraph";

/**
 * DEV-only console probes for the calendar data layer. Mounted unconditionally
 * in App — `EntraGraphTokenProvider` only exists under NAA, so hooks registered
 * there never appear in the other auth modes (exactly where SE validation
 * happens). Renders nothing; gated out of prod by `import.meta.env.DEV`.
 *
 * - `window.__eratoCalendar()` runs the production backend selection
 *   (on-prem probe → EWS or Graph) so live validation exercises the same path
 *   consumers get.
 * - `window.__eratoCalendarGraph()` pins the Graph backend (SI-2 / ERMAIN-384).
 */
export function CalendarDevProbe(): null {
  const graph = useGraphTokenOptional();

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const devWindow = window as Window & {
      __eratoCalendar?: () => Promise<unknown>;
      __eratoCalendarGraph?: () => Promise<unknown>;
    };
    const acquireCalendarToken: AcquireGraphToken | null = graph
      ? (options) =>
          graph.acquireToken(["Calendars.Read"], {
            ...options,
            allowInteraction: true,
          })
      : null;
    const requireGraphToken = (): AcquireGraphToken => {
      if (!acquireCalendarToken) {
        throw new Error(
          "Graph token context not mounted (non-NAA auth mode) — cloud calendar unavailable here",
        );
      }
      return acquireCalendarToken;
    };
    devWindow.__eratoCalendar = async () => {
      const [{ detectExchangeOnPrem }, factories] = await Promise.all([
        import("../utils/detectExchangeOnPrem"),
        import("../utils/fetchOutlookCalendar"),
      ]);
      const backend = detectExchangeOnPrem() ? "ews" : "graph";
      console.info(`[__eratoCalendar] backend: ${backend}`);
      const fetcher =
        backend === "ews"
          ? factories.createEwsOutlookCalendarFetcher()
          : factories.createGraphOutlookCalendarFetcher(requireGraphToken());
      return { backend, calendar: await fetcher.fetchCalendar() };
    };
    devWindow.__eratoCalendarGraph = async () => {
      const { fetchOutlookCalendarViaGraph } = await import(
        "../utils/fetchOutlookCalendarGraph"
      );
      return fetchOutlookCalendarViaGraph(requireGraphToken());
    };
    return () => {
      delete devWindow.__eratoCalendar;
      delete devWindow.__eratoCalendarGraph;
    };
  }, [graph]);

  return null;
}
