/**
 * Router-free infinite recent-chats list.
 *
 * The shared core of every paginated chat listing: the web sidebar wraps it
 * with routing, pinned chats and placeholder rows (`useChatHistory`), while
 * hosts without routes (the add-in) consume it directly. Filters are server
 * params on purpose — filtering client-side would corrupt the offset-based
 * pagination this rides on.
 */
import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import {
  fetchRecentChats,
  recentChatsQuery,
  type RecentChatsError,
  type RecentChatsQueryParams,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { useV1betaApiContext } from "@/lib/generated/v1betaApi/v1betaApiContext";

import {
  CHAT_HISTORY_FILTER_DEFAULTS,
  type ChatHistoryFilterValues,
} from "./store/chatHistoryFilterStore";

import type { RecentChat } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export const CHAT_HISTORY_PAGE_SIZE = 30;

/** The filter-store values that reach the recent-chats request. */
export type RecentChatsListFilters = Pick<
  ChatHistoryFilterValues,
  "typeFilter" | "statusFilter"
>;

/**
 * Query params the list filters add to a recent-chats request. Key builders
 * and the query itself must agree on these, so both go through here.
 */
export function buildRecentChatsFilterParams(
  filters: RecentChatsListFilters,
): Pick<RecentChatsQueryParams, "type" | "include_archived"> {
  return {
    ...(filters.typeFilter === "all" ? {} : { type: filters.typeFilter }),
    ...(filters.statusFilter === "all" ? { include_archived: true } : {}),
  };
}

/**
 * Query key of the infinite recent-chats list; cache edits must target the
 * same key as the query itself.
 */
export function buildInfiniteChatsQueryKey(
  pinnedChatsEnabled = false,
  filters: RecentChatsListFilters = CHAT_HISTORY_FILTER_DEFAULTS,
) {
  return [
    ...recentChatsQuery({
      queryParams: {
        ...(pinnedChatsEnabled ? { pinned: false } : {}),
        ...buildRecentChatsFilterParams(filters),
      },
    }).queryKey,
    "infinite",
    { limit: CHAT_HISTORY_PAGE_SIZE },
  ];
}

export interface InfiniteRecentChatsOptions {
  filters: RecentChatsListFilters;
  /** Excludes pinned rows so a separate pinned query can own them. */
  pinnedChatsEnabled?: boolean;
}

const EMPTY_CHATS: RecentChat[] = [];

export function useInfiniteRecentChats({
  filters,
  pinnedChatsEnabled = false,
}: InfiniteRecentChatsOptions) {
  const { fetcherOptions } = useV1betaApiContext();

  const queryKey = useMemo(
    () => buildInfiniteChatsQueryKey(pinnedChatsEnabled, filters),
    [pinnedChatsEnabled, filters],
  );

  const {
    data,
    isLoading,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<
    Awaited<ReturnType<typeof fetchRecentChats>>,
    RecentChatsError
  >({
    queryKey,
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => {
      const offset = typeof pageParam === "number" ? pageParam : 0;
      return fetchRecentChats(
        {
          ...fetcherOptions,
          queryParams: {
            limit: CHAT_HISTORY_PAGE_SIZE,
            offset,
            ...(pinnedChatsEnabled ? { pinned: false } : {}),
            ...buildRecentChatsFilterParams(filters),
          },
        },
        signal,
      );
    },
    getNextPageParam: (lastPage) => {
      if (!lastPage.stats.has_more || lastPage.stats.returned_count === 0) {
        return undefined;
      }
      return lastPage.stats.current_offset + lastPage.stats.returned_count;
    },
  });

  const chats = useMemo(
    () => data?.pages.flatMap((page) => page.chats) ?? EMPTY_CHATS,
    [data?.pages],
  );

  return {
    chats,
    isLoading,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    queryKey,
  };
}
