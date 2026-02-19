/**
 * Custom hook for chat history management
 *
 * Provides a clean interface for fetching, navigating and managing chat history.
 */
/* eslint-disable lingui/no-unlocalized-strings */
import { useQueryClient } from "@tanstack/react-query";
// import { useRouter } from "next/navigation"; // Removed Next.js router
import { useCallback, useMemo } from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom"; // Added React Router hooks
import { create } from "zustand";
import { devtools } from "zustand/middleware";

import {
  useRecentChats,
  useArchiveChatEndpoint,
  useUpdateChat,
  recentChatsQuery,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
// Import context and merge utility
// import { useV1betaApiContext } from "@/lib/generated/v1betaApi/v1betaApiContext";
import { deepMerge } from "@/lib/generated/v1betaApi/v1betaApiUtils";
import { getChatUrl } from "@/utils/chat/urlUtils";
import { createLogger } from "@/utils/debugLogger";

import { getStreamKey, useMessagingStore } from "./store/messagingStore";

// Import the correct response type and the RecentChat type from schemas
// No longer needed after switching to invalidateQueries:
// import type {
//   RecentChatsResponse,
//   RecentChat,
// } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const logger = createLogger("HOOK", "useChatHistory");

interface ChatHistoryState {
  isNewChatPending: boolean; // Flag to indicate a new chat navigation is in progress
  setNewChatPending: (isPending: boolean) => void;
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

  // Get context to access fetcherOptions - contextFetcherOptions removed as it was unused after introducing stableEmptyFetcherOptions
  // const { fetcherOptions: contextFetcherOptions } = useV1betaApiContext();
  const { isNewChatPending, setNewChatPending } = useChatHistoryStore();

  // Fetch chats using the generated API hook (passing empty object directly)
  const { data, isLoading, error, refetch } = useRecentChats({});

  // Generated hook for archiving a chat
  const { mutateAsync: archiveChatMutation } = useArchiveChatEndpoint();
  // Generated hook for updating chat metadata
  const { mutateAsync: updateChatMutation } = useUpdateChat();

  // Memoize the empty array reference
  const emptyChats = useMemo(() => [], []);

  // Create a stable empty object for fetcherOptions, reflecting what useV1betaApiContext currently returns
  const stableEmptyFetcherOptions = useMemo(() => ({}), []);

  // Extract chats from the response structure, defaulting to a stable empty array reference
  const chats = data?.chats ?? emptyChats;

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
          queryKey: ["chatMessages", { chatId: currentChatId }],
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
  }, [navigate, setNewChatPending, currentChatId]); // Updated dependency array

  // Archive a chat
  const archiveChat = useCallback(
    async (chatId: string) => {
      // Replicate the key generation process used by the hook:
      // 1. Merge stableEmptyFetcherOptions with base variables ({})
      const mergedVariables = deepMerge(stableEmptyFetcherOptions, {}); // Use stable reference
      // 2. Get the query definition using the *merged* variables
      const queryDefinition = recentChatsQuery(mergedVariables);
      // 3. Extract the queryKey from the definition
      const queryKey = queryDefinition.queryKey;

      try {
        // Call the mutation
        await archiveChatMutation({
          pathParams: { chatId },
          body: {}, // Send empty object as body
        });

        // Invalidate the query - React Query will refetch it automatically
        // when components using it are active.
        await queryClient.invalidateQueries({ queryKey }); // Use the generated key

        // If the archived chat was the current one, navigate to the new chat page
        if (currentChatId === chatId) {
          // router.replace("/chat/new"); // Navigate to the new chat page
          navigate("/chat/new", { replace: true }); // Replaced router.replace with navigate
        }
        // If not the current chat, no navigation occurs.
      } catch (error) {
        logger.log(`Failed to archive chat ${chatId}:`, error);
        // Consider adding error handling, e.g., show a notification
        // If using optimistic updates, would need to revert changes here
        throw error; // Re-throw error for potential handling upstream
      }
    },
    // fetcherOptions is needed for queryKey generation
    [
      archiveChatMutation,
      queryClient,
      currentChatId,
      // router,
      navigate, // Updated dependency array
      stableEmptyFetcherOptions, // Use stable reference in dependency array
    ],
  );

  // Update chat title_by_user_provided
  const updateChatTitle = useCallback(
    async (chatId: string, titleByUserProvided?: string) => {
      const mergedVariables = deepMerge(stableEmptyFetcherOptions, {});
      const queryDefinition = recentChatsQuery(mergedVariables);
      const queryKey = queryDefinition.queryKey;

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
    [queryClient, stableEmptyFetcherOptions, updateChatMutation],
  );

  return {
    chats,
    currentChatId,
    isLoading,
    error,
    refetch,
    navigateToChat,
    createNewChat,
    archiveChat,
    updateChatTitle,
    isNewChatPending,
  };
}
