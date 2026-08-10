import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { runWithConcurrency } from "../../utils/graph/graphClient";
import { runWithGraphTimeout } from "../../utils/graph/graphRequestTimeout";
import {
  parseTeamChannels,
  sortTeamsChannels,
} from "../utils/parsedTeamsChannel";
import { TEAMS_GRAPH_LIST_TIMEOUT_MS } from "../utils/teamsGraphTimeouts";

import type { ParsedTeamsChannel } from "../utils/parsedTeamsChannel";
import type { TeamsChannelFetcher } from "../utils/teamsChatFetcher";

/** Teams are listed in one call; their channels are one call each, so cap the fan-out. */
const TEAM_CHANNEL_CONCURRENCY = 3;

export interface UseTeamsChannelListResult {
  channels: ParsedTeamsChannel[];
  channelsByKey: ReadonlyMap<string, ParsedTeamsChannel>;
  isLoading: boolean;
  /**
   * True for a missing consent as much as a network failure: the channel
   * scopes need an admin, so callers must treat this as "chats only" rather
   * than as a broken picker.
   */
  isError: boolean;
  /** Some teams answered and some did not — show what landed, plus a note. */
  isPartial: boolean;
  refetch: () => void;
}

export function useTeamsChannelList(
  fetcher: TeamsChannelFetcher | null,
): UseTeamsChannelListResult {
  const query = useQuery({
    queryKey: ["office-addin", "teams", "channels"],
    enabled: fetcher !== null,
    retry: false,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) => {
      if (!fetcher) return { channels: [], failedTeams: 0, teamsFailed: true };
      return runWithGraphTimeout(
        TEAMS_GRAPH_LIST_TIMEOUT_MS,
        `Teams channel list timed out after ${TEAMS_GRAPH_LIST_TIMEOUT_MS}ms`,
        signal,
        async (timeoutSignal) => {
          const teams = await fetcher.listJoinedTeams({
            signal: timeoutSignal,
          });
          if (teams.state === "error") {
            return { channels: [], failedTeams: 0, teamsFailed: true };
          }
          const collected: ParsedTeamsChannel[][] = teams.teams.map(() => []);
          let failedTeams = 0;
          await runWithConcurrency(
            teams.teams.map((team, index) => async () => {
              if (!team.id) return;
              const result = await fetcher.listChannels(team.id, {
                signal: timeoutSignal,
              });
              if (result.state === "error") {
                failedTeams += 1;
                return;
              }
              collected[index] = parseTeamChannels(team, result.channels);
            }),
            TEAM_CHANNEL_CONCURRENCY,
          );
          return {
            channels: sortTeamsChannels(collected.flat()),
            failedTeams,
            teamsFailed: false,
          };
        },
      );
    },
  });

  const channels = useMemo(
    () => query.data?.channels ?? [],
    [query.data?.channels],
  );
  const channelsByKey = useMemo(
    () =>
      new Map(
        channels.map((channel) => [
          `${channel.teamId}/${channel.channelId}`,
          channel,
        ]),
      ),
    [channels],
  );

  return {
    channels,
    channelsByKey,
    isLoading: query.isPending && fetcher !== null,
    isError: query.isError || (query.data?.teamsFailed ?? false),
    isPartial: (query.data?.failedTeams ?? 0) > 0,
    refetch: () => void query.refetch(),
  };
}
