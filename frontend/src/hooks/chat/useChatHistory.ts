/**
 * Custom hook for chat history management
 *
 * Provides a clean interface for fetching, navigating and managing chat history.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { create } from "zustand";

import { useRecentChats } from "@/lib/generated/v1betaApi/v1betaApiComponents";

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
  const {
    currentChatId,
    isNewChatPending,
    setCurrentChatId,
    setNewChatPending,
  } = useChatHistoryStore();

  // Fetch chats using the generated API hook
  const { data, isLoading, error, refetch } = useRecentChats({});

  // Extract chats from the response structure
  const chats = data?.chats || [];

  // Navigate to a specific chat
  const navigateToChat = useCallback(
    (chatId: string) => {
      // If a new chat navigation is pending, don't override the current chat ID
      if (isNewChatPending) {
        console.log(
          `[CHAT_FLOW] Not setting currentChatId to ${chatId} because a new chat is pending`,
        );
        return;
      }

      console.log(`[CHAT_FLOW] Navigating to chat: ${chatId}`);
      setCurrentChatId(chatId);
      router.push(`/chat/${chatId}`);
    },
    [router, setCurrentChatId, isNewChatPending],
  );

  // Create a new chat and navigate to it
  const createNewChat = useCallback(async () => {
    try {
      console.log("[CHAT_FLOW] Creating new chat - resetting currentChatId");

      // Set the pending flag first to prevent unwanted changes to currentChatId
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
      setNewChatPending(false);
      throw error;
    }
  }, [router, setCurrentChatId, setNewChatPending]);

  // Delete a chat
  const deleteChat = useCallback(
    async (chatId: string) => {
      try {
        // In a real implementation, this would call an API endpoint
        // For now, just invalidate the query cache
        await queryClient.invalidateQueries({ queryKey: ["chats"] });

        // If the deleted chat was the current one, navigate to the home page
        if (currentChatId === chatId) {
          router.push("/");
          setCurrentChatId(null);
        }
      } catch (error) {
        console.error("Failed to delete chat:", error);
        throw error;
      }
    },
    [currentChatId, queryClient, router, setCurrentChatId],
  );

  return {
    chats,
    currentChatId,
    isLoading,
    error,
    refetch,
    navigateToChat,
    createNewChat,
    deleteChat,
    isNewChatPending,
  };
}
