import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { runWithGraphTimeout } from "../../utils/graph/graphRequestTimeout";
import { parseTeamsChat } from "../utils/parsedTeamsChat";
import { TEAMS_GRAPH_LIST_TIMEOUT_MS } from "../utils/teamsGraphTimeouts";

import type {
  ParsedTeamsChat,
  TeamsSelfIdentity,
} from "../utils/parsedTeamsChat";
import type { TeamsChatFetcher } from "../utils/teamsChatFetcher";

export interface UseTeamsChatListResult {
  chats: ParsedTeamsChat[];
  /** Chat metadata by id — the browse cache search rows resolve titles from. */
  chatsById: ReadonlyMap<string, ParsedTeamsChat>;
  isLoading: boolean;
  isError: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMore: () => void;
  refetch: () => void;
}

/**
 * The signed-in user's chats, paged. No `$orderby` reaches Graph (it rejects
 * ordering on expanded navigation properties), so recency ordering is applied
 * here across every page fetched so far.
 */
export function useTeamsChatList(
  fetcher: TeamsChatFetcher | null,
  self?: TeamsSelfIdentity,
): UseTeamsChatListResult {
  const query = useInfiniteQuery({
    queryKey: ["office-addin", "teams", "chats"],
    enabled: fetcher !== null,
    retry: false,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      if (!fetcher)
        return { chats: [], nextLink: null, state: "error" as const };
      return runWithGraphTimeout(
        TEAMS_GRAPH_LIST_TIMEOUT_MS,
        `Teams chat list timed out after ${TEAMS_GRAPH_LIST_TIMEOUT_MS}ms`,
        signal,
        (timeoutSignal) =>
          fetcher.listChats({ nextLink: pageParam, signal: timeoutSignal }),
      );
    },
    getNextPageParam: (lastPage) => lastPage.nextLink ?? undefined,
  });

  const chats = useMemo(() => {
    const parsed: ParsedTeamsChat[] = [];
    for (const page of query.data?.pages ?? []) {
      for (const chat of page.chats) {
        const entry = parseTeamsChat(chat, self);
        if (entry) parsed.push(entry);
      }
    }
    return parsed.sort(
      (a, b) => activityTime(b.lastActivityAt) - activityTime(a.lastActivityAt),
    );
  }, [query.data, self]);

  const chatsById = useMemo(
    () => new Map(chats.map((chat) => [chat.chatId, chat])),
    [chats],
  );

  const firstPageFailed =
    query.isError || query.data?.pages[0]?.state === "error";

  return {
    chats,
    chatsById,
    isLoading: query.isPending && fetcher !== null,
    isError: firstPageFailed,
    hasMore: query.hasNextPage,
    isLoadingMore: query.isFetchingNextPage,
    loadMore: () => void query.fetchNextPage(),
    refetch: () => void query.refetch(),
  };
}

function activityTime(iso: string | null): number {
  if (!iso) return 0;
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? 0 : parsed;
}
