import { useMemo } from "react";

import { useSessionAuth } from "../../core/SessionAuthProvider";
import { useGraphTokenOptional } from "../../core/auth/GraphTokenProvider";
import { createGraphTeamsFileFetcher } from "../utils/teamsChatFetcher";

import type { AcquireGraphToken } from "../../utils/graph/graphClient";
import type { TeamsFileFetcher } from "../utils/teamsChatFetcher";

/**
 * Held apart from the chat and channel scopes: `Files.Read.All` spans the
 * user's whole OneDrive/SharePoint reach and needs its own admin decision, so
 * acquiring it together with the others would let a tenant that never granted
 * it lose messages as well.
 */
export const GRAPH_TEAMS_FILE_SCOPES = ["Files.Read.All"];

export type TeamsFileFetcherUnavailableReason =
  | "graph-unavailable"
  | "unsupported-mode";

export interface UseTeamsFileFetcherResult {
  fetcher: TeamsFileFetcher | null;
  unavailableReason: TeamsFileFetcherUnavailableReason | null;
}

/**
 * Never throws, and a non-null fetcher is not proof of consent — the scope is
 * only exercised on first use, so callers must still handle an error state.
 */
export function useTeamsFileFetcher(): UseTeamsFileFetcherResult {
  const { mode } = useSessionAuth();
  const graph = useGraphTokenOptional();

  return useMemo<UseTeamsFileFetcherResult>(() => {
    if (mode !== "entra-msal") {
      return { fetcher: null, unavailableReason: "unsupported-mode" };
    }
    if (!graph) {
      return { fetcher: null, unavailableReason: "graph-unavailable" };
    }
    const acquireGraphToken: AcquireGraphToken = (options) =>
      graph.acquireToken(GRAPH_TEAMS_FILE_SCOPES, options);
    return {
      fetcher: createGraphTeamsFileFetcher(acquireGraphToken),
      unavailableReason: null,
    };
  }, [graph, mode]);
}
