/**
 * Custom hook for chat history management
 *
 * Provides a clean interface for fetching, navigating and managing chat history.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { create } from "zustand";

import { useChats } from "@/lib/generated/v1betaApi/v1betaApiComponents";

interface ChatHistoryState {
  currentChatId: string | null;
  setCurrentChatId: (id: string | null) => void;
}

// Create a store to track the current selected chat
// This allows sharing the selection state across components
const useChatHistoryStore = create<ChatHistoryState>((set) => ({
  currentChatId: null,
  setCurrentChatId: (id) => set({ currentChatId: id }),
}));

export function useChatHistory() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { currentChatId, setCurrentChatId } = useChatHistoryStore();

  // Fetch chats using the generated API hook
  const { data: chats, isLoading, error, refetch } = useChats({});

  // Navigate to a specific chat
  const navigateToChat = useCallback(
    (chatId: string) => {
      setCurrentChatId(chatId);
      router.push(`/chat/${chatId}`);
    },
    [router, setCurrentChatId],
  );

  // Create a new chat and navigate to it
  const createNewChat = useCallback(async () => {
    try {
      // In a real implementation, this would call an API endpoint
      // to create a new chat and get its ID
      // For now, we'll generate a temporary ID
      const tempId = `new-chat-${Date.now()}`;

      // Navigate to the new chat
      router.push(`/chat/new`);

      return tempId;
    } catch (error) {
      console.error("Failed to create new chat:", error);
      throw error;
    }
  }, [router]);

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
  };
}
