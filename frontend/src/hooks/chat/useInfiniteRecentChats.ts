/**
 * Router-free infinite recent-chats list.
 *
 * The shared core of every paginated chat listing: the web sidebar wraps it
 * with routing, pinned chats and placeholder rows (`useChatHistory`), while
 * hosts without routes (the add-in) consume it directly. Filters are server
 * params on purpose — filtering client-side would corrupt the offset-based
 * pagination this rides on.
 */
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import {
  fetchRecentChats,
  recentChatsQuery,
  useUpdateChat,
  type RecentChatsError,
  type RecentChatsQueryParams,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { useV1betaApiContext } from "@/lib/generated/v1betaApi/v1betaApiContext";
import { createLogger } from "@/utils/debugLogger";

import {
  CHAT_HISTORY_FILTER_DEFAULTS,
  type ChatHistoryFilterValues,
} from "./store/chatHistoryFilterStore";

import type { RecentChat } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { InfiniteData, QueryClient } from "@tanstack/react-query";

const logger = createLogger("HOOK", "useInfiniteRecentChats");

export const CHAT_HISTORY_PAGE_SIZE = 30;

// Shape of the infinite recent-chats cache entry.
type RecentChatsPage = Awaited<ReturnType<typeof fetchRecentChats>>;
type InfiniteRecentChats = InfiniteData<RecentChatsPage>;
/**
 * The recent-chats key prefix also covers surfaces that read a single page
 * through a plain query, so a cache edit has to expect either shape.
 */
export type RecentChatsCacheEntry = InfiniteRecentChats | RecentChatsPage;

export const isPaginated = (
  entry: RecentChatsCacheEntry,
): entry is InfiniteRecentChats =>
  Array.isArray((entry as InfiniteRecentChats).pages);

function withoutChat(page: RecentChatsPage, chatId: string): RecentChatsPage {
  const chats = page.chats.filter((chat) => chat.id !== chatId);
  if (chats.length === page.chats.length) return page;
  const removed = page.chats.length - chats.length;
  return {
    ...page,
    chats,
    stats: {
      ...page.stats,
      returned_count: Math.max(0, page.stats.returned_count - removed),
      total_count: Math.max(0, page.stats.total_count - removed),
    },
  };
}

/**
 * Whether a recent-chats cache key belongs to an archived-inclusive list
 * variant, i.e. one whose rows legitimately keep an archived chat.
 */
function queryKeyIncludesArchived(queryKey: readonly unknown[]): boolean {
  return queryKey.some(
    (part) =>
      typeof part === "object" &&
      part !== null &&
      (part as { include_archived?: boolean }).include_archived === true,
  );
}

/**
 * Optimistically remove an archived chat's row from every loaded page of
 * every cached non-archived list variant, returning a rollback for a failed
 * mutation.
 *
 * The caches are deliberately edited in place rather than invalidated: a
 * refetch re-derives each page's offset from getNextPageParam, and once the
 * archive shrinks the server-side result set every page boundary past the
 * row shifts by one, silently skipping the chat that straddled it. Archived-
 * inclusive variants legitimately keep the row, but its archived_at changed,
 * so they are marked stale without refetching while mounted (same skew).
 */
export async function removeArchivedChatFromLists(
  queryClient: QueryClient,
  chatId: string,
): Promise<() => void> {
  // Settle in-flight list fetches first (e.g. a focus refetch): one
  // resolving after the snapshot below would overwrite the optimistic
  // removal and resurrect the archived row.
  await queryClient.cancelQueries({
    queryKey: recentChatsQuery({}).queryKey,
  });

  const previousEntries = queryClient.getQueriesData<RecentChatsCacheEntry>({
    queryKey: recentChatsQuery({}).queryKey,
  });

  queryClient.setQueriesData<RecentChatsCacheEntry>(
    {
      queryKey: recentChatsQuery({}).queryKey,
      predicate: (query) => !queryKeyIncludesArchived(query.queryKey),
    },
    (current) => {
      if (!current) return current;
      if (!isPaginated(current)) return withoutChat(current, chatId);
      return {
        ...current,
        pages: current.pages.map((page) => withoutChat(page, chatId)),
      };
    },
  );

  const hasArchivedListVariant = previousEntries.some(([queryKey]) =>
    queryKeyIncludesArchived(queryKey),
  );
  if (hasArchivedListVariant) {
    void queryClient.invalidateQueries({
      queryKey: recentChatsQuery({}).queryKey,
      predicate: (query) => queryKeyIncludesArchived(query.queryKey),
      refetchType: "none",
    });
  }

  return () => {
    for (const [queryKey, previousData] of previousEntries) {
      if (previousData) {
        queryClient.setQueryData(queryKey, previousData);
      }
    }
  };
}

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

/**
 * Callback that renames a chat and refreshes every recent-chats list variant.
 */
export function useUpdateChatTitle() {
  const queryClient = useQueryClient();
  const { mutateAsync: updateChatMutation } = useUpdateChat();

  return useCallback(
    async (chatId: string, titleByUserProvided?: string) => {
      const queryKey = recentChatsQuery({}).queryKey;

      try {
        const trimmedTitle = titleByUserProvided?.trim();
        await updateChatMutation({
          pathParams: { chatId },
          body: trimmedTitle
            ? { title_by_user_provided: trimmedTitle }
            : // Empty value removes custom title on backend.
              {},
        });
        await queryClient.invalidateQueries({ queryKey });
      } catch (error) {
        logger.log(`Failed to update chat title for ${chatId}:`, error);
        throw error;
      }
    },
    [queryClient, updateChatMutation],
  );
}
