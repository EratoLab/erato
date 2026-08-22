/**
 * Custom hook for chat history management
 *
 * Provides a clean interface for fetching, navigating and managing chat history.
 */
/* eslint-disable lingui/no-unlocalized-strings */
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
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

import { useChatHistoryFilterStore } from "./store/chatHistoryFilterStore";
import {
  seedGenerationStatusFromListing,
  useGenerationStatusStore,
} from "./store/generationStatusStore";
import { getStreamKey, useMessagingStore } from "./store/messagingStore";
import {
  removeArchivedChatFromLists,
  useInfiniteRecentChats,
  useUpdateChatTitle,
  type RecentChatsListFilters,
} from "./useInfiniteRecentChats";

import type { RecentChat } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

// Moved to their router-free home; re-exported for existing import sites.
export {
  CHAT_HISTORY_PAGE_SIZE,
  buildInfiniteChatsQueryKey,
  buildRecentChatsFilterParams,
  isPaginated,
  type RecentChatsCacheEntry,
  type RecentChatsListFilters,
} from "./useInfiniteRecentChats";

const logger = createLogger("HOOK", "useChatHistory");

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

  const pinnedChatsQueryKey = useMemo(
    () =>
      recentChatsQuery({
        queryParams: { pinned: true, limit: pinnedChatsLimit },
      }).queryKey,
    [pinnedChatsLimit],
  );

  const {
    chats: listedChats,
    isLoading,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteRecentChats({
    filters: listFilters,
    pinnedChatsEnabled,
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
      // A just-created chat is never a delegated run.
      provenance_kind: undefined,
      provenance_run_mode: undefined,
      origin_chat_id: undefined,
      origin_chat_title: undefined,
      origin_assistant_id: undefined,
      delegated_run_outcome: undefined,
    };
    return [placeholder, ...listedChats];
  }, [listedChats, pendingChat, isPendingChatListed, typeFilter]);

  // Seed the status store from the backend's running and pending-approval
  // markers, so generations started (or parked) elsewhere get an indicator
  // without waiting for a poll.
  useEffect(() => {
    seedGenerationStatusFromListing(chats);
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
        if (currentChatId === chatId) {
          navigate("/chat/new", { replace: true });
        }
        // Not awaited: navigation away from the archived chat must not wait
        // for every list variant to refetch page by page.
        void queryClient.invalidateQueries({
          queryKey: recentChatsQuery({}).queryKey,
        });
        return;
      }

      const previousPendingChat = useChatHistoryStore.getState().pendingChat;

      // The archived row may be the pending-chat placeholder, which lives
      // outside the cache and no list edit can take away; drop it too.
      clearPendingChat(chatId);

      // An archived chat has no row, so its status must not keep counting.
      useGenerationStatusStore.getState().clearStatus(chatId);
      useChatHistoryStore.getState().clearTitleHint(chatId);

      const rollbackListRemoval = await removeArchivedChatFromLists(
        queryClient,
        chatId,
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
        rollbackListRemoval();
        if (previousPendingChat?.id === chatId) {
          useChatHistoryStore.getState().setPendingChat(previousPendingChat);
        }
        throw error; // Re-throw error for potential handling upstream
      }
    },
    [archiveChatMutation, queryClient, currentChatId, navigate, statusFilter],
  );

  // Update chat title_by_user_provided
  const updateChatTitle = useUpdateChatTitle();

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
