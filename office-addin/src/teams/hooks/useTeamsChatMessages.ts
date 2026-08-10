import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { runWithGraphTimeout } from "../../utils/graph/graphRequestTimeout";
import { parseTeamsMessages } from "../utils/parsedTeamsChat";
import { TEAMS_GRAPH_LIST_TIMEOUT_MS } from "../utils/teamsGraphTimeouts";

import type { ParsedTeamsMessage } from "../utils/parsedTeamsChat";
import type { TeamsChatFetcher } from "../utils/teamsChatFetcher";

export interface UseTeamsChatMessagesResult {
  messages: ParsedTeamsMessage[];
  isLoading: boolean;
  isError: boolean;
  /** Older history exists — the "Load earlier" affordance. */
  hasMore: boolean;
  isLoadingMore: boolean;
  loadEarlier: () => void;
  refetch: () => void;
}

/**
 * One chat's messages, newest first. Chat messages sort descending only, so
 * following `@odata.nextLink` is paging backwards. The infinite query fetches
 * pages one at a time by construction, which is the correct shape for a
 * 1 rps-per-chat resource; the transport's gate is the belt to that suspenders.
 */
export function useTeamsChatMessages(
  fetcher: TeamsChatFetcher | null,
  chatId: string | null,
): UseTeamsChatMessagesResult {
  const enabled = fetcher !== null && chatId !== null;

  const query = useInfiniteQuery({
    queryKey: ["office-addin", "teams", "messages", chatId],
    enabled,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      if (!fetcher || !chatId) {
        return {
          messages: [],
          nextLink: null,
          status: 0,
          ok: false,
        };
      }
      return runWithGraphTimeout(
        TEAMS_GRAPH_LIST_TIMEOUT_MS,
        `Teams chat messages timed out after ${TEAMS_GRAPH_LIST_TIMEOUT_MS}ms`,
        signal,
        (timeoutSignal) =>
          fetcher.listMessagesPage(chatId, {
            nextLink: pageParam,
            signal: timeoutSignal,
          }),
      );
    },
    getNextPageParam: (lastPage) => lastPage.nextLink ?? undefined,
  });

  const messages = useMemo(() => {
    if (!chatId) return [];
    const raw = (query.data?.pages ?? []).flatMap((page) => page.messages);
    return parseTeamsMessages(raw, chatId);
  }, [chatId, query.data]);

  return {
    messages,
    isLoading: query.isPending && enabled,
    isError: query.isError || query.data?.pages[0]?.ok === false,
    hasMore: query.hasNextPage,
    isLoadingMore: query.isFetchingNextPage,
    loadEarlier: () => void query.fetchNextPage(),
    refetch: () => void query.refetch(),
  };
}
