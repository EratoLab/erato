import { useMemo } from "react";

import { useSessionAuth } from "../../core/SessionAuthProvider";
import { useGraphTokenOptional } from "../../core/auth/GraphTokenProvider";
import { createGraphTeamsChannelFetcher } from "../utils/teamsChatFetcher";

import type { AcquireGraphToken } from "../../utils/graph/graphClient";
import type { TeamsChannelFetcher } from "../utils/teamsChatFetcher";

/**
 * Held apart from the chat scopes on purpose: `ChannelMessage.Read.All` needs
 * admin consent, so acquiring these together with `Chat.Read` would let a
 * tenant that never granted it lose chats as well.
 */
export const GRAPH_TEAMS_CHANNEL_SCOPES = [
  "Team.ReadBasic.All",
  "Channel.ReadBasic.All",
  "ChannelMessage.Read.All",
];

export type TeamsChannelFetcherUnavailableReason =
  | "graph-unavailable"
  | "unsupported-mode";

export interface UseTeamsChannelFetcherResult {
  fetcher: TeamsChannelFetcher | null;
  unavailableReason: TeamsChannelFetcherUnavailableReason | null;
}

/**
 * Never throws, and a non-null fetcher is not proof of consent — the scopes are
 * only exercised on first use, so callers must still handle an error state.
 */
export function useTeamsChannelFetcher(): UseTeamsChannelFetcherResult {
  const { mode } = useSessionAuth();
  const graph = useGraphTokenOptional();

  return useMemo<UseTeamsChannelFetcherResult>(() => {
    if (mode !== "entra-msal") {
      return { fetcher: null, unavailableReason: "unsupported-mode" };
    }
    if (!graph) {
      return { fetcher: null, unavailableReason: "graph-unavailable" };
    }
    const acquireGraphToken: AcquireGraphToken = (options) =>
      graph.acquireToken(GRAPH_TEAMS_CHANNEL_SCOPES, options);
    return {
      fetcher: createGraphTeamsChannelFetcher(acquireGraphToken),
      unavailableReason: null,
    };
  }, [graph, mode]);
}
