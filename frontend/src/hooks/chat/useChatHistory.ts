/**
 * Custom hook for chat history management
 *
 * Provides a clean interface for fetching, navigating and managing chat history.
 */
/* eslint-disable lingui/no-unlocalized-strings */
import {
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom"; // Added React Router hooks
import { create } from "zustand";
import { devtools } from "zustand/middleware";

import {
  fetchRecentChats,
  useArchiveChatEndpoint,
  useUpdateChat,
  recentChatsQuery,
  chatMessagesQuery,
  type RecentChatsError,
  type RecentChatsQueryParams,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { useV1betaApiContext } from "@/lib/generated/v1betaApi/v1betaApiContext";
import { getChatUrl } from "@/utils/chat/urlUtils";
import { createLogger } from "@/utils/debugLogger";

import {
  CHAT_HISTORY_FILTER_DEFAULTS,
  useChatHistoryFilterStore,
  type ChatHistoryFilterValues,
} from "./store/chatHistoryFilterStore";
import { useGenerationStatusStore } from "./store/generationStatusStore";
import { getStreamKey, useMessagingStore } from "./store/messagingStore";

import type { RecentChat } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const logger = createLogger("HOOK", "useChatHistory");
const CHAT_HISTORY_PAGE_SIZE = 30;

/**
 * A chat that exists on the backend but is not listable yet, with the moment it
 * was created. `get_recent_chats` only returns chats that already have a
 * message, and the backend creates the chat row before it inserts the first
 * user message, so between `chat_created` and the first list fetch after
 * `user_message_saved` there is nothing to render a row from.
 */
export interface PendingChat {
  id: string;
  createdAt: string;
  /**
   * Set only when the chat was started from an assistant page. Selecting the
   * row has to keep the assistant in the URL, and the list response that would
   * otherwise carry the assistant has not arrived yet.
   */
  assistantId?: string;
}

/**
 * `T` with its optional fields made mandatory to write but still allowed to be
 * `undefined`, so a field added to the generated type cannot silently default
 * to absent here.
 */
type Complete<T> = { [K in keyof Required<T>]: T[K] };

// Shape of the infinite recent-chats cache entry.
type RecentChatsPage = Awaited<ReturnType<typeof fetchRecentChats>>;
type InfiniteRecentChats = InfiniteData<RecentChatsPage>;

interface ChatHistoryState {
  isNewChatPending: boolean; // Flag to indicate a new chat navigation is in progress
  setNewChatPending: (isPending: boolean) => void;
  pendingChat: PendingChat | null;
  setPendingChat: (chat: PendingChat | null) => void;
  /**
   * First words of the user message that started a chat; stands in as the
   * row title until the backend reports a real one.
   */
  titleHintByChatId: Partial<Record<string, string>>;
  setTitleHint: (chatId: string, hint: string) => void;
  clearTitleHint: (chatId: string) => void;
}

// Create a store to track the current selected chat
// This allows sharing the selection state across components
export const useChatHistoryStore = create<ChatHistoryState>()(
  devtools(
    (set) => {
      // Initialize with default state
      const initialState: ChatHistoryState = {
        isNewChatPending: false,
        setNewChatPending: (isPending) =>
          set(
            { isNewChatPending: isPending },
            false,
            "chatHistory/setNewChatPending",
          ),
        pendingChat: null,
        // Returning the current state for a no-op write keeps the snapshot
        // identity, so the redundant clears (one per mounted `useChatHistory`)
        // do not notify subscribers.
        setPendingChat: (chat) =>
          set(
            (state) =>
              state.pendingChat === chat ? state : { pendingChat: chat },
            false,
            "chatHistory/setPendingChat",
          ),
        titleHintByChatId: {},
        setTitleHint: (chatId, hint) =>
          set(
            (state) =>
              state.titleHintByChatId[chatId] === hint
                ? state
                : {
                    titleHintByChatId: {
                      ...state.titleHintByChatId,
                      [chatId]: hint,
                    },
                  },
            false,
            "chatHistory/setTitleHint",
          ),
        clearTitleHint: (chatId) =>
          set(
            (state) => {
              if (!(chatId in state.titleHintByChatId)) {
                return state;
              }
              const titleHintByChatId = { ...state.titleHintByChatId };
              delete titleHintByChatId[chatId];
              return { titleHintByChatId };
            },
            false,
            "chatHistory/clearTitleHint",
          ),
      };

      // Add debugging for state changes
      logger.log("Initializing chat history store with state:", initialState);

      return initialState;
    },
    {
      name: "Chat History Store",
      store: "chat-history-store",
      enabled: process.env.NODE_ENV === "development",
    },
  ),
);

/**
 * Drops the placeholder row for a chat whose first turn can no longer make it
 * listable: nothing else will ever remove it, because the clearing effect below
 * only fires when the chat shows up in the list, which a chat without a saved
 * user message never does.
 *
 * `chatId` scopes the clear so a concurrent first turn keeps its own
 * placeholder; pass nothing to clear whichever chat is pending.
 */
export function clearPendingChat(chatId?: string) {
  const { pendingChat, setPendingChat } = useChatHistoryStore.getState();
  if (!pendingChat) {
    return;
  }
  if (chatId !== undefined && pendingChat.id !== chatId) {
    return;
  }
  setPendingChat(null);
}

/**
 * Whether the sidebar is currently rendering `chatId` from the placeholder,
 * i.e. whether the list is known to be missing a row for it.
 */
export function isPendingChat(chatId: string): boolean {
  return useChatHistoryStore.getState().pendingChat?.id === chatId;
}

const TITLE_HINT_MAX_LENGTH = 40;

/** Condenses a user message into something row-title sized. */
export function deriveTitleHint(text: string): string | null {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (!collapsed) {
    return null;
  }
  if (collapsed.length <= TITLE_HINT_MAX_LENGTH) {
    return collapsed;
  }
  const cut = collapsed.slice(0, TITLE_HINT_MAX_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");
  const stem =
    lastSpace > TITLE_HINT_MAX_LENGTH / 2 ? cut.slice(0, lastSpace) : cut;
  return `${stem.trimEnd()}…`;
}

/** The filter-store values that reach the recent-chats request. */
export type RecentChatsListFilters = Pick<
  ChatHistoryFilterValues,
  "typeFilter" | "statusFilter"
>;

/**
 * Query params the sidebar filters add to a recent-chats list request. Key
 * builders and the query itself must agree on these, so both go through here.
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

export interface ChatHistoryOptions {
  pinnedChatsEnabled?: boolean;
  pinnedChatsLimit?: number;
}

export function useChatHistory({
  pinnedChatsEnabled = false,
  pinnedChatsLimit = 5,
}: ChatHistoryOptions = {}) {
  // const router = useRouter(); // Removed Next.js router
  const navigate = useNavigate(); // Added React Router navigate
  const location = useLocation();
  const params = useParams<{ id?: string; chatId?: string }>();
  const queryClient = useQueryClient();

  // Derive currentChatId from URL (single source of truth)
  const currentChatId = useMemo(() => {
    // Check if we're on /chat/new or /chat
    if (location.pathname === "/chat/new" || location.pathname === "/chat") {
      return null;
    }
    // Extract ID from /chat/:id or /a/:assistantId/:chatId
    // For assistant routes, chatId param takes precedence
    return params.chatId ?? params.id ?? null;
  }, [location.pathname, params.id, params.chatId]);

  const { fetcherOptions } = useV1betaApiContext();
  const isNewChatPending = useChatHistoryStore(
    (state) => state.isNewChatPending,
  );
  const setNewChatPending = useChatHistoryStore(
    (state) => state.setNewChatPending,
  );
  const pendingChat = useChatHistoryStore((state) => state.pendingChat);
  const setPendingChat = useChatHistoryStore((state) => state.setPendingChat);

  // Raw persisted values on purpose: every mounted copy of this hook must
  // derive the same query key, and the sidebar folds feature-gated values back
  // to their defaults in the store itself.
  const typeFilter = useChatHistoryFilterStore((state) => state.typeFilter);
  const statusFilter = useChatHistoryFilterStore((state) => state.statusFilter);
  const listFilters = useMemo<RecentChatsListFilters>(
    () => ({ typeFilter, statusFilter }),
    [typeFilter, statusFilter],
  );

  // Stable query key for the infinite recent-chats list. Reused for both the
  // query itself and for cache mutations (e.g. optimistic archive removal).
  const infiniteChatsQueryKey = useMemo(
    () => buildInfiniteChatsQueryKey(pinnedChatsEnabled, listFilters),
    [pinnedChatsEnabled, listFilters],
  );
  const pinnedChatsQueryKey = useMemo(
    () =>
      recentChatsQuery({
        queryParams: { pinned: true, limit: pinnedChatsLimit },
      }).queryKey,
    [pinnedChatsLimit],
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
    queryKey: infiniteChatsQueryKey,
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
            ...buildRecentChatsFilterParams(listFilters),
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

  const { data: pinnedChatsData } = useInfiniteQuery<
    Awaited<ReturnType<typeof fetchRecentChats>>,
    RecentChatsError
  >({
    queryKey: pinnedChatsQueryKey,
    initialPageParam: 0,
    enabled: pinnedChatsEnabled,
    queryFn: ({ signal }) =>
      fetchRecentChats(
        {
          ...fetcherOptions,
          queryParams: { limit: pinnedChatsLimit, pinned: true },
        },
        signal,
      ),
    getNextPageParam: () => undefined,
  });

  // Generated hook for archiving a chat
  const { mutateAsync: archiveChatMutation } = useArchiveChatEndpoint();
  // Generated hook for updating chat metadata
  const { mutateAsync: updateChatMutation } = useUpdateChat();

  // Memoize the empty array reference
  const emptyChats = useMemo(() => [], []);

  // Extract chats from the paginated response structure, defaulting to a stable empty array reference
  const listedChats = useMemo(
    () => data?.pages.flatMap((page) => page.chats) ?? emptyChats,
    [data?.pages, emptyChats],
  );
  const pinnedChats = useMemo(
    () => pinnedChatsData?.pages.flatMap((page) => page.chats) ?? emptyChats,
    [emptyChats, pinnedChatsData?.pages],
  );

  const isPendingChatListed = pendingChat
    ? listedChats.some((chat) => chat.id === pendingChat.id)
    : false;

  // Once the backend lists the chat, the placeholder has served its purpose.
  // Dropping it here is what keeps it from resurfacing later: the placeholder
  // outranks the list, so a stale one would re-appear as a ghost row the moment
  // the real row leaves the list, e.g. by being archived. This covers only
  // chats that do get listed; the paths where that never happens clear the
  // placeholder themselves.
  useEffect(() => {
    if (isPendingChatListed) {
      setPendingChat(null);
    }
  }, [isPendingChatListed, setPendingChat]);

  const chats = useMemo<RecentChat[]>(() => {
    if (!pendingChat || isPendingChatListed) {
      return listedChats;
    }
    // A placeholder the active type filter excludes must not render: the
    // filtered list will never contain the chat, so the listing effect below
    // could never clear it and the row would linger as a ghost.
    if (
      (typeFilter === "assistant" && !pendingChat.assistantId) ||
      (typeFilter === "chat" && pendingChat.assistantId)
    ) {
      return listedChats;
    }
    // Everything the sidebar renders, plus `assistant_id` so selecting the row
    // stays on the assistant route. `last_selected_facets` and `last_model` are
    // deliberately undefined: consumers treat a present value as authoritative
    // and would override what the assistant configured for the first turn.
    // `can_edit` is false to match what an unlisted chat resolves to today.
    const placeholder: Complete<RecentChat> = {
      id: pendingChat.id,
      title_resolved: "",
      title_by_summary: undefined,
      title_by_user_provided: undefined,
      can_edit: false,
      file_uploads: [],
      last_message_at: pendingChat.createdAt,
      is_pinned: false,
      assistant_id: pendingChat.assistantId,
      assistant_name: undefined,
      archived_at: undefined,
      last_chat_provider_id: undefined,
      last_selected_facets: undefined,
      last_model: undefined,
      // The placeholder exists precisely while the first turn streams.
      active_generation_started_at: pendingChat.createdAt,
      pending_tool_approval_at: undefined,
    };
    return [placeholder, ...listedChats];
  }, [listedChats, pendingChat, isPendingChatListed, typeFilter]);

  // Seed the status store from the backend's running and pending-approval
  // markers, so generations started (or parked) elsewhere get an indicator
  // without waiting for a poll.
  useEffect(() => {
    const { seedRunning, seedActionRequired } =
      useGenerationStatusStore.getState();
    for (const chat of chats) {
      if (chat.active_generation_started_at) {
        seedRunning(chat.id, chat.active_generation_started_at);
      }
      if (chat.pending_tool_approval_at) {
        seedActionRequired(chat.id, chat.pending_tool_approval_at);
      }
    }
  }, [chats]);

  // Navigate to a specific chat (assistant-aware)
  const navigateToChat = useCallback(
    (chatId: string) => {
      // If a new chat navigation is pending, don't override the current chat ID
      if (isNewChatPending) {
        logger.log(
          `navigateToChat BLOCKED: Navigation to ${chatId} is prevented because isNewChatPending is true. This is expected behavior during certain operations.`,
        );
        return;
      }

      // Mark current chat's data as stale before navigating away
      // This ensures React Query will refetch when returning to this chat
      // Especially important if the chat was streaming when we navigated away
      if (currentChatId) {
        logger.log(
          `navigateToChat: Marking chat ${currentChatId} as stale before navigating to ${chatId}`,
        );
        void queryClient.invalidateQueries({
          queryKey: chatMessagesQuery({
            pathParams: { chatId: currentChatId },
          }).queryKey,
          refetchType: "none",
        });
      }

      // Look up the chat to check if it has an assistant
      const chat = chats.find((c) => c.id === chatId);
      const url = getChatUrl(chatId, chat?.assistant_id);

      logger.log(`navigateToChat: Navigating to ${url}`);
      navigate(url);
    },
    [navigate, isNewChatPending, chats, currentChatId, queryClient],
  );

  // Create a new chat and navigate to it
  const createNewChat = useCallback(async () => {
    try {
      logger.log("Creating new chat - navigating to /chat/new");

      // Same staleness marking as navigateToChat, which this path bypasses.
      if (currentChatId) {
        void queryClient.invalidateQueries({
          queryKey: chatMessagesQuery({
            pathParams: { chatId: currentChatId },
          }).queryKey,
          refetchType: "none",
        });
      }

      // CRITICAL: Clear ALL messaging state before navigation.
      // We intentionally clear across all stream keys to avoid resurrecting
      // an older in-flight new-chat stream when user clicks "new chat" again.
      const messagingStore = useMessagingStore.getState();
      messagingStore.abortAllSSE();
      messagingStore.clearUserMessages();
      messagingStore.clearAllStreaming();
      messagingStore.clearAllApiMessages();
      messagingStore.setNewlyCreatedChatIdInStore(null);
      messagingStore.setAwaitingFirstStreamChunkForNewChat(false);
      messagingStore.setSSEAbortCallback(null, getStreamKey(currentChatId));

      // Aborting the streams above abandons any first turn still in flight.
      clearPendingChat();

      // Set the pending flag first to prevent unwanted changes during navigation
      logger.log("Setting isNewChatPending to TRUE");
      setNewChatPending(true);

      // Make sure the store state gets updated immediately before navigation
      // This is necessary to avoid state inconsistency during navigation
      await Promise.resolve(); // Force microtask queue to flush

      logger.log("Store updated, navigating to /chat/new");

      // For more reliable navigation with Next.js App Router, use replace instead of push
      // This prevents issues with the router queue and history management
      // router.replace("/chat/new");
      navigate("/chat/new", { replace: true }); // Replaced router.replace with navigate

      // Return a temporary ID - the actual chat ID will be created when the first message is sent

      return `temp-${Date.now()}`;
    } catch (error) {
      logger.log("Failed to create new chat:", error);
      // Reset the pending flag if there's an error
      logger.log("Error in createNewChat - setting isNewChatPending to FALSE");
      setNewChatPending(false);
      throw error;
    }
  }, [navigate, setNewChatPending, currentChatId, queryClient]);

  // Archive a chat
  const archiveChat = useCallback(
    async (chatId: string) => {
      // With the status filter on "all" the archived chat legitimately stays
      // listed, so removing its row would be wrong — and a plain refetch is
      // safe here precisely because the include_archived result set does not
      // shrink, which is what makes removal-driven offset skew impossible.
      if (statusFilter === "all") {
        await archiveChatMutation({ pathParams: { chatId }, body: {} });
        clearPendingChat(chatId);
        useGenerationStatusStore.getState().clearStatus(chatId);
        useChatHistoryStore.getState().clearTitleHint(chatId);
        await queryClient.invalidateQueries({
          queryKey: recentChatsQuery({}).queryKey,
        });
        if (currentChatId === chatId) {
          navigate("/chat/new", { replace: true });
        }
        return;
      }

      // Snapshot every recent-chats cache entry and the pending placeholder so
      // a failed mutation can roll them all back.
      const previousEntries = queryClient.getQueriesData<InfiniteRecentChats>({
        queryKey: recentChatsQuery({}).queryKey,
      });
      const previousPendingChat = useChatHistoryStore.getState().pendingChat;

      // The archived row may be the pending-chat placeholder, which lives
      // outside the cache and no list edit can take away; drop it too.
      clearPendingChat(chatId);

      // An archived chat has no row, so its status must not keep counting.
      useGenerationStatusStore.getState().clearStatus(chatId);
      useChatHistoryStore.getState().clearTitleHint(chatId);

      // Optimistically remove the archived row from every loaded page of every
      // cached list variant — the row must not resurface when the user
      // switches to a sibling filter combination whose cache is still fresh.
      //
      // We deliberately mutate the caches in place rather than invalidating
      // and refetching every page. A full refetch re-derives each page's
      // offset from getNextPageParam (current_offset + returned_count); once
      // the archive shrinks the server-side result set, every page boundary
      // past the archived row shifts by one, so the refetch silently skips the
      // chat that straddled the boundary (ERMAIN-474). Editing the cache keeps
      // the list stable and makes the row disappear immediately, without
      // waiting for a round trip.
      queryClient.setQueriesData<InfiniteRecentChats>(
        {
          queryKey: recentChatsQuery({}).queryKey,
          predicate: (query) => !queryKeyIncludesArchived(query.queryKey),
        },
        (current) => {
          // The prefix also matches non-paginated recent-chats caches, which
          // have no `pages` to edit.
          if (!current || !Array.isArray(current.pages)) return current;
          return {
            ...current,
            pages: current.pages.map((page) => {
              const chats = page.chats.filter((chat) => chat.id !== chatId);
              if (chats.length === page.chats.length) return page;
              const removed = page.chats.length - chats.length;
              return {
                ...page,
                chats,
                stats: {
                  ...page.stats,
                  returned_count: Math.max(
                    0,
                    page.stats.returned_count - removed,
                  ),
                  total_count: Math.max(0, page.stats.total_count - removed),
                },
              };
            }),
          };
        },
      );
      // Archived-inclusive variants legitimately keep the row, but its
      // archived_at changed; mark them stale so they refetch on next mount
      // (never refetching a mounted paginated list, per the skew above).
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

      try {
        // Call the mutation
        await archiveChatMutation({
          pathParams: { chatId },
          body: {}, // Send empty object as body
        });

        // If the archived chat was the current one, navigate to the new chat page
        if (currentChatId === chatId) {
          navigate("/chat/new", { replace: true });
        }
        // If not the current chat, no navigation occurs.
      } catch (error) {
        logger.log(`Failed to archive chat ${chatId}:`, error);
        // Roll back the optimistic removal so the rows reappear.
        for (const [queryKey, previousData] of previousEntries) {
          if (previousData) {
            queryClient.setQueryData(queryKey, previousData);
          }
        }
        if (previousPendingChat?.id === chatId) {
          useChatHistoryStore.getState().setPendingChat(previousPendingChat);
        }
        throw error; // Re-throw error for potential handling upstream
      }
    },
    [archiveChatMutation, queryClient, currentChatId, navigate, statusFilter],
  );

  // Update chat title_by_user_provided
  const updateChatTitle = useCallback(
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

  const pinChat = useCallback(
    async (chatId: string, isPinned: boolean) => {
      try {
        await updateChatMutation({
          pathParams: { chatId },
          body: { is_pinned: isPinned },
        });
        await queryClient.invalidateQueries({
          queryKey: recentChatsQuery({}).queryKey,
        });
      } catch (error) {
        logger.log(
          `Failed to ${isPinned ? "pin" : "unpin"} chat ${chatId}:`,
          error,
        );
        throw error;
      }
    },
    [queryClient, updateChatMutation],
  );

  return {
    chats,
    pinnedChats,
    currentChatId,
    isLoading,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    navigateToChat,
    createNewChat,
    archiveChat,
    updateChatTitle,
    pinChat,
    isNewChatPending,
  };
}
