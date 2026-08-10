import { useMemo } from "react";

import { useSessionAuth } from "../../core/SessionAuthProvider";
import { useGraphTokenOptional } from "../../core/auth/GraphTokenProvider";
import { createGraphTeamsChatFetcher } from "../utils/teamsChatFetcher";

import type { AcquireGraphToken } from "../../utils/graph/graphClient";
import type { TeamsChatFetcher } from "../utils/teamsChatFetcher";

/**
 * Listing chats, reading message bodies and `/search/query` are all covered by
 * delegated `Chat.Read`. Nothing here needs `Chat.ReadWrite` or a `.All` scope,
 * and attachment bytes are deliberately never fetched, so `Files.Read.All`
 * stays out of the picture too.
 */
export const GRAPH_TEAMS_CHAT_SCOPES = ["Chat.Read"];

export type TeamsChatFetcherUnavailableReason =
  /** Authenticated, but no Graph token context is mounted (no NAA bridge). */
  | "graph-unavailable"
  /** Not authenticated (mode isn't `entra-msal`). */
  | "unsupported-mode";

export interface UseTeamsChatFetcherResult {
  fetcher: TeamsChatFetcher | null;
  unavailableReason: TeamsChatFetcherUnavailableReason | null;
}

/**
 * Selects the Teams chat backend. NEVER throws — callers hide the picker entry
 * rather than opening a dialog that can only apologise.
 */
export function useTeamsChatFetcher(): UseTeamsChatFetcherResult {
  const { mode } = useSessionAuth();
  const graph = useGraphTokenOptional();

  return useMemo<UseTeamsChatFetcherResult>(() => {
    if (mode !== "entra-msal") {
      return { fetcher: null, unavailableReason: "unsupported-mode" };
    }
    if (!graph) {
      return { fetcher: null, unavailableReason: "graph-unavailable" };
    }
    const acquireGraphToken: AcquireGraphToken = (options) =>
      graph.acquireToken(GRAPH_TEAMS_CHAT_SCOPES, options);
    return {
      fetcher: createGraphTeamsChatFetcher(acquireGraphToken),
      unavailableReason: null,
    };
  }, [graph, mode]);
}
