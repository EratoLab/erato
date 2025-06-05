/**
 * Custom hook for chat history management
 *
 * Provides a clean interface for fetching, navigating and managing chat history.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";
import { create } from "zustand";

import {
  useRecentChats,
  useArchiveChatEndpoint,
  recentChatsQuery,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
// Import context and merge utility
// import { useV1betaApiContext } from "@/lib/generated/v1betaApi/v1betaApiContext";
import { deepMerge } from "@/lib/generated/v1betaApi/v1betaApiUtils";

// Import the correct response type and the RecentChat type from schemas
// No longer needed after switching to invalidateQueries:
// import type {
//   RecentChatsResponse,
//   RecentChat,
// } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

interface ChatHistoryState {
  currentChatId: string | null;
  isNewChatPending: boolean; // Flag to indicate a new chat navigation is in progress
  setCurrentChatId: (id: string | null) => void;
  setNewChatPending: (isPending: boolean) => void;
}

// Create a store to track the current selected chat
// This allows sharing the selection state across components
export const useChatHistoryStore = create<ChatHistoryState>((set) => {
  // Initialize with default state
  const initialState: ChatHistoryState = {
    currentChatId: null,
    isNewChatPending: false,
    setCurrentChatId: (id) => set({ currentChatId: id }),
    setNewChatPending: (isPending) => set({ isNewChatPending: isPending }),
  };

  // Add debugging for state changes
  console.log(
    "[CHAT_FLOW] Initializing chat history store with state:",
    initialState,
  );

  return initialState;
});

export function useChatHistory() {
  const router = useRouter();
  const queryClient = useQueryClient();
  // Get context to access fetcherOptions - contextFetcherOptions removed as it was unused after introducing stableEmptyFetcherOptions
  // const { fetcherOptions: contextFetcherOptions } = useV1betaApiContext();
  const {
    currentChatId,
    isNewChatPending,
    setCurrentChatId,
    setNewChatPending,
  } = useChatHistoryStore();

  // Fetch chats using the generated API hook (passing empty object directly)
  const { data, isLoading, error, refetch } = useRecentChats({});

  // Generated hook for archiving a chat
  const { mutateAsync: archiveChatMutation } = useArchiveChatEndpoint();

  // Memoize the empty array reference
  const emptyChats = useMemo(() => [], []);

  // Create a stable empty object for fetcherOptions, reflecting what useV1betaApiContext currently returns
  const stableEmptyFetcherOptions = useMemo(() => ({}), []);

  // Extract chats from the response structure, defaulting to a stable empty array reference
  const chats = data?.chats ?? emptyChats;

  // Navigate to a specific chat
  const navigateToChat = useCallback(
    (chatId: string) => {
      // If a new chat navigation is pending, don't override the current chat ID
      if (isNewChatPending) {
        console.log(
          `[DEBUG_REDIRECT] navigateToChat BLOCKED: Navigation to ${chatId} is prevented because isNewChatPending is true. This is expected behavior during certain operations.`,
        );
        return;
      }

      console.log(
        `[DEBUG_REDIRECT] navigateToChat: Successfully navigating to chat: ${chatId}`,
      );
      setCurrentChatId(chatId);

      // Make sure we actually navigate to the chat URL using the router
      // Use replace to ensure a clean navigation
      router.push(`/chat/${chatId}`);
    },
    [router, setCurrentChatId, isNewChatPending],
  );

  // Create a new chat and navigate to it
  const createNewChat = useCallback(async () => {
    try {
      console.log(
        "[DEBUG_REDIRECT] Creating new chat - resetting currentChatId",
      );

      // Set the pending flag first to prevent unwanted changes to currentChatId
      console.log("[DEBUG_REDIRECT] Setting isNewChatPending to TRUE");
      setNewChatPending(true);

      // Reset the current chat ID
      setCurrentChatId(null);

      // Make sure the store state gets updated immediately before navigation
      // This is necessary to avoid state inconsistency during navigation
      await Promise.resolve(); // Force microtask queue to flush

      console.log("[CHAT_FLOW] Store updated, navigating to /chat/new");

      // For more reliable navigation with Next.js App Router, use replace instead of push
      // This prevents issues with the router queue and history management
      router.replace("/chat/new");

      // Return a temporary ID - the actual chat ID will be created when the first message is sent
      return `temp-${Date.now()}`;
    } catch (error) {
      console.error("Failed to create new chat:", error);
      // Reset the pending flag if there's an error
      console.log(
        "[DEBUG_REDIRECT] Error in createNewChat - setting isNewChatPending to FALSE",
      );
      setNewChatPending(false);
      throw error;
    }
  }, [router, setCurrentChatId, setNewChatPending]);

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
          setCurrentChatId(null); // Reset current chat ID in the store
          router.replace("/chat/new"); // Navigate to the new chat page
        }
        // If not the current chat, no navigation occurs.
      } catch (error) {
        console.error(`Failed to archive chat ${chatId}:`, error);
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
      router,
      setCurrentChatId,
      stableEmptyFetcherOptions, // Use stable reference in dependency array
    ],
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
    isNewChatPending,
  };
}
