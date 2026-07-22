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
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { useV1betaApiContext } from "@/lib/generated/v1betaApi/v1betaApiContext";
import { getChatUrl } from "@/utils/chat/urlUtils";
import { createLogger } from "@/utils/debugLogger";

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

export function useChatHistory() {
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

  // Stable query key for the infinite recent-chats list. Reused for both the
  // query itself and for cache mutations (e.g. optimistic archive removal).
  const infiniteChatsQueryKey = useMemo(
    () => [
      ...recentChatsQuery({}).queryKey,
      "infinite",
      { limit: CHAT_HISTORY_PAGE_SIZE },
    ],
    [],
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
      assistant_id: pendingChat.assistantId,
      assistant_name: undefined,
      archived_at: undefined,
      last_chat_provider_id: undefined,
      last_selected_facets: undefined,
      last_model: undefined,
    };
    return [placeholder, ...listedChats];
  }, [listedChats, pendingChat, isPendingChatListed]);

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
      // Snapshot the cache and pending placeholder so a failed mutation can
      // roll both back.
      const previousData = queryClient.getQueryData<InfiniteRecentChats>(
        infiniteChatsQueryKey,
      );
      const previousPendingChat = useChatHistoryStore.getState().pendingChat;

      // The archived row may be the pending-chat placeholder, which lives
      // outside the cache and no list edit can take away; drop it too.
      clearPendingChat(chatId);

      // Optimistically remove the archived row from every loaded page.
      //
      // We deliberately mutate the cache in place rather than invalidating and
      // refetching every page. A full refetch re-derives each page's offset
      // from getNextPageParam (current_offset + returned_count); once the
      // archive shrinks the server-side result set, every page boundary past
      // the archived row shifts by one, so the refetch silently skips the chat
      // that straddled the boundary (ERMAIN-474). Editing the cache keeps the
      // list stable and makes the row disappear immediately, without waiting
      // for a round trip.
      queryClient.setQueryData<InfiniteRecentChats>(
        infiniteChatsQueryKey,
        (current) => {
          if (!current) return current;
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
        if (previousData) {
          queryClient.setQueryData(infiniteChatsQueryKey, previousData);
        }
        if (previousPendingChat?.id === chatId) {
          useChatHistoryStore.getState().setPendingChat(previousPendingChat);
        }
        throw error; // Re-throw error for potential handling upstream
      }
    },
    [
      archiveChatMutation,
      queryClient,
      currentChatId,
      navigate,
      infiniteChatsQueryKey,
    ],
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

  return {
    chats,
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
    isNewChatPending,
  };
}
