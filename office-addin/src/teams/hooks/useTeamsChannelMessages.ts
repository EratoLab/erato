import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { runWithGraphTimeout } from "../../utils/graph/graphRequestTimeout";
import { parseTeamsMessages } from "../utils/parsedTeamsChat";
import { TEAMS_GRAPH_LIST_TIMEOUT_MS } from "../utils/teamsGraphTimeouts";

import type { UseTeamsChatMessagesResult } from "./useTeamsChatMessages";
import type { TeamsChannelFetcher } from "../utils/teamsChatFetcher";

/**
 * Drill-down for one channel. Same paging contract as a chat — newest first,
 * "load earlier" walks backwards — so the dialog renders both the same way.
 */
export function useTeamsChannelMessages(
  fetcher: TeamsChannelFetcher | null,
  target: { teamId: string; channelId: string } | null,
): UseTeamsChatMessagesResult {
  const enabled = fetcher !== null && target !== null;
  const conversationId = target ? `${target.teamId}/${target.channelId}` : null;

  const query = useInfiniteQuery({
    queryKey: ["office-addin", "teams", "channel-messages", conversationId],
    enabled,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      if (!fetcher || !target) {
        return { messages: [], nextLink: null, status: 0, ok: false };
      }
      return runWithGraphTimeout(
        TEAMS_GRAPH_LIST_TIMEOUT_MS,
        `Teams channel messages timed out after ${TEAMS_GRAPH_LIST_TIMEOUT_MS}ms`,
        signal,
        (timeoutSignal) =>
          fetcher.listMessagesPage(target.teamId, target.channelId, {
            nextLink: pageParam,
            signal: timeoutSignal,
          }),
      );
    },
    getNextPageParam: (lastPage) => lastPage.nextLink ?? undefined,
  });

  const messages = useMemo(() => {
    if (!conversationId) return [];
    const raw = (query.data?.pages ?? []).flatMap((page) => page.messages);
    return parseTeamsMessages(raw, conversationId);
  }, [conversationId, query.data]);

  const pages = query.data?.pages ?? [];
  const firstPageFailed = query.isError || pages[0]?.ok === false;

  return {
    messages,
    isLoading: query.isPending && enabled,
    isError: firstPageFailed,
    isPartial: !firstPageFailed && pages.some((page) => !page.ok),
    hasMore: query.hasNextPage,
    isLoadingMore: query.isFetchingNextPage,
    loadEarlier: () => void query.fetchNextPage(),
    refetch: () => void query.refetch(),
  };
}
