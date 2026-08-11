import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { runWithGraphTimeout } from "../../utils/graph/graphRequestTimeout";
import { SEARCH_PAGE_SIZE } from "../utils/teamsChatGraph";
import { TEAMS_GRAPH_SEARCH_TIMEOUT_MS } from "../utils/teamsGraphTimeouts";

import type { TeamsChatFetcher } from "../utils/teamsChatFetcher";
import type { TeamsSearchHit } from "../utils/teamsChatGraph";

/** Below this a query is noise, and `/search/query` is not a cheap call. */
export const MIN_SEARCH_QUERY_LENGTH = 3;

export interface UseTeamsChatSearchResult {
  hits: TeamsSearchHit[];
  isLoading: boolean;
  /**
   * A changed query is running while `hits` still shows the previous results —
   * the trade `keepPreviousData` makes, which otherwise looks like a finished
   * search.
   */
  isRefreshing: boolean;
  isError: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMore: () => void;
  refetch: () => void;
}

/**
 * Keyword search over chat messages. `POST /search/query` is the only keyword
 * path — `GET /chats/{id}/messages` has no `$search`. Hits carry NO body: the
 * snippet is the product here, and content is fetched only on attach.
 *
 * `query` is expected to already be debounced by the caller.
 */
export function useTeamsChatSearch(
  fetcher: TeamsChatFetcher | null,
  query: string,
): UseTeamsChatSearchResult {
  const trimmed = query.trim();
  const enabled = fetcher !== null && trimmed.length >= MIN_SEARCH_QUERY_LENGTH;

  const search = useInfiniteQuery({
    queryKey: ["office-addin", "teams", "search", trimmed],
    enabled,
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    placeholderData: keepPreviousData,
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => {
      if (!fetcher) {
        return {
          hits: [],
          moreResultsAvailable: false,
          nextFrom: pageParam,
          state: "error" as const,
        };
      }
      return runWithGraphTimeout(
        TEAMS_GRAPH_SEARCH_TIMEOUT_MS,
        `Teams chat search timed out after ${TEAMS_GRAPH_SEARCH_TIMEOUT_MS}ms`,
        signal,
        (timeoutSignal) =>
          fetcher.searchMessages(trimmed, {
            from: pageParam,
            size: SEARCH_PAGE_SIZE,
            signal: timeoutSignal,
          }),
      );
    },
    getNextPageParam: (lastPage) =>
      lastPage.moreResultsAvailable ? lastPage.nextFrom : undefined,
  });

  const hits = useMemo(
    () => (search.data?.pages ?? []).flatMap((page) => page.hits),
    [search.data],
  );

  return {
    hits,
    isLoading: search.isPending && enabled,
    isRefreshing:
      search.isFetching && !search.isPending && !search.isFetchingNextPage,
    isError: search.isError || search.data?.pages[0]?.state === "error",
    hasMore: search.hasNextPage,
    isLoadingMore: search.isFetchingNextPage,
    loadMore: () => void search.fetchNextPage(),
    refetch: () => void search.refetch(),
  };
}
