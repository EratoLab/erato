import * as reactQuery from "@tanstack/react-query";
import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useMap } from "react-use";

import { ChatHistoryContext } from "../../contexts/ChatHistoryContext";
import {
  useMessages,
  fetchRecentChats,
} from "../../lib/generated/v1betaApi/v1betaApiComponents";

import type { ChatHistoryContextType } from "../../types/chat-history";
import type { RecentChat } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ChatSession } from "@/types/chat";

// Debug logging
const DEBUG = process.env.NODE_ENV === "development";
const log = (...args: unknown[]) => DEBUG && console.log(...args);

interface ChatHistoryProviderProps extends React.PropsWithChildren {
  initialSessions?: ChatSession[];
  initialSessionId?: string;
}

// Constants
const CHATS_PAGE_SIZE = 20;

export const ChatHistoryProvider: React.FC<ChatHistoryProviderProps> = ({
  children,
  initialSessions = [],
  initialSessionId = null,
}) => {
  // Use useMap for better performance with frequent updates
  const [sessions, { set, remove }] = useMap<Record<string, ChatSession>>(
    initialSessions.reduce(
      (acc, session) => ({
        ...acc,
        [session.id]: session,
      }),
      {},
    ),
  );

  const sortedSessions = useMemo(
    () =>
      Object.values(sessions)
        .filter((session) => session.metadata?.isTemporary !== true) // Filter out temporary sessions
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()),
    [sessions],
  );

  // Use React Query for current session management
  const { data: currentSessionId } = reactQuery.useQuery({
    queryKey: ["currentSessionId"],
    queryFn: () => initialSessionId,
    initialData: initialSessionId,
    staleTime: Infinity,
  });

  // Store setter for currentSessionId
  const queryClient = reactQuery.useQueryClient();
  const setCurrentSessionId = useCallback(
    (newId: string | null) => {
      queryClient.setQueryData(["currentSessionId"], newId);
    },
    [queryClient],
  );

  // Change error state to match the context type (undefined instead of null)
  const [error, setError] = useState<Error | undefined>(undefined);

  // Use React Query's useInfiniteQuery for paginated chat history
  const {
    data: paginatedChatsData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isPending: isPendingChats,
    refetch: refetchChats,
  } = reactQuery.useInfiniteQuery({
    queryKey: ["recentChats"],
    queryFn: async ({ pageParam = 0 }) => {
      // Use the generated API function
      return fetchRecentChats({
        queryParams: {
          limit: CHATS_PAGE_SIZE,
          offset: pageParam,
        },
      });
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      // Return next offset for pagination or undefined if no more data
      return lastPage.stats.has_more
        ? lastPage.stats.current_offset + lastPage.stats.returned_count
        : undefined;
    },
    staleTime: 30000, // 30 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
  });

  // Sync RecentChat data with sessions state when they load
  useEffect(() => {
    if (!paginatedChatsData) return;

    // Process all pages of chat data
    paginatedChatsData.pages.forEach((page) => {
      if (page.chats.length > 0) {
        page.chats.forEach((recentChat: RecentChat) => {
          // Only add new sessions
          if (!Object.prototype.hasOwnProperty.call(sessions, recentChat.id)) {
            // Convert RecentChat to ChatSession format
            const chatSession: ChatSession = {
              id: recentChat.id,
              title: recentChat.title_by_summary || "Untitled Chat",
              messages: [], // Messages will be loaded separately
              createdAt: new Date(), // We don't have this info, use current time
              updatedAt: new Date(recentChat.last_message_at),
            };
            set(recentChat.id, chatSession);
          }
        });
      }
    });
  }, [paginatedChatsData, sessions, set]);

  // Load messages for the current session
  const { isPending: isPendingMessages } = useMessages(
    currentSessionId && !currentSessionId.startsWith("temp-")
      ? { queryParams: { sessionId: currentSessionId } }
      : reactQuery.skipToken,
    {
      enabled: !!currentSessionId && !currentSessionId.startsWith("temp-"),
      staleTime: 5000,
      gcTime: 60000,
    },
  );

  // Create a new temporary session
  const createSession = useCallback(() => {
    try {
      const tempId = `temp-${new Date().toISOString()}`;
      const newSession: ChatSession = {
        id: tempId,
        title: "New Chat",
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: {
          isTemporary: true,
          ownerId: "", // Will be set when confirmed with first message
        },
      };
      set(tempId, newSession);
      setCurrentSessionId(tempId);
      return tempId;
    } catch (e) {
      setError(e instanceof Error ? e : new Error("Failed to create session"));
      return "";
    }
  }, [set, setCurrentSessionId]);

  // Convert a temporary session to a permanent one
  const confirmSession = useCallback(
    (tempId: string, permanentId: string) => {
      if (Object.prototype.hasOwnProperty.call(sessions, tempId)) {
        const tempSession = sessions[tempId];
        // Create a permanent session from the temporary one
        const permanentSession: ChatSession = {
          ...tempSession,
          id: permanentId,
          metadata: {
            ...tempSession.metadata,
            isTemporary: false,
            ownerId: tempSession.metadata?.ownerId ?? "",
          },
        };

        // Add the permanent session and set it as current
        set(permanentId, permanentSession);
        setCurrentSessionId(permanentId);

        // Remove the temporary session
        if (tempId !== permanentId) {
          remove(tempId);
        }

        // Refresh the chat list after confirming a new session
        void refetchChats();
      }
    },
    [sessions, set, setCurrentSessionId, remove, refetchChats],
  );

  // Update an existing session
  const updateSession = useCallback(
    (sessionId: string, updates: Partial<ChatSession>) => {
      const currentSession = sessions[sessionId];
      set(sessionId, {
        ...currentSession,
        ...updates,
        updatedAt: new Date(),
      });
    },
    [sessions, set],
  );

  // Delete a session
  const deleteSession = useCallback(
    (sessionId: string) => {
      remove(sessionId);
      if (currentSessionId === sessionId) {
        setCurrentSessionId(null);
      }
    },
    [currentSessionId, remove, setCurrentSessionId],
  );

  // Switch to a different session
  const switchSession = useCallback(
    (sessionId: string) => {
      setCurrentSessionId(sessionId);
    },
    [setCurrentSessionId],
  );

  // Get the current active session
  const getCurrentSession = useCallback(() => {
    return currentSessionId ? (sessions[currentSessionId] ?? null) : null;
  }, [sessions, currentSessionId]);

  // Load more chats using infinite pagination
  const loadMoreChats = useCallback(async () => {
    if (isFetchingNextPage || !hasNextPage) return;

    try {
      log("Loading more chats with fetchNextPage");
      await fetchNextPage();
    } catch (e) {
      setError(e instanceof Error ? e : new Error("Failed to load more chats"));
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  // Calculate if we have more chats
  const hasMoreChats = hasNextPage === true;

  // Determine if we are loading anything
  const isPending =
    isPendingChats ||
    (isPendingMessages &&
      typeof currentSessionId === "string" &&
      !currentSessionId.startsWith("temp-"));

  // Clean up temporary sessions on startup and whenever sessions change
  useEffect(() => {
    // Clean up any stale temporary sessions that aren't the current session
    const tempSessionsToRemove = Object.values(sessions).filter(
      (session) =>
        session.metadata?.isTemporary === true &&
        session.id !== currentSessionId &&
        // Only remove temp sessions older than 10 minutes
        Date.now() - session.updatedAt.getTime() > 10 * 60 * 1000,
    );

    if (tempSessionsToRemove.length > 0) {
      log(
        `Cleaning up ${tempSessionsToRemove.length} stale temporary sessions`,
      );
      tempSessionsToRemove.forEach((session) => {
        remove(session.id);
      });
    }
  }, [sessions, currentSessionId, remove]);

  // Expose the context
  const contextValue: ChatHistoryContextType = {
    sessions: sortedSessions,
    currentSessionId,
    error,
    isPending,
    createSession,
    confirmSession,
    updateSession,
    deleteSession,
    switchSession,
    getCurrentSession,
    loadMoreChats,
    hasMoreChats,
    refreshChats: refetchChats,
  };

  // Expose the context globally for our ChatBridge component
  useEffect(() => {
    if (typeof window !== "undefined") {
      // Make confirmSession available globally
      const win = window as unknown as {
        __CHAT_HISTORY_CONTEXT__?: { confirmSession?: typeof confirmSession };
      };
      win.__CHAT_HISTORY_CONTEXT__ = {
        confirmSession,
      };
    }
    return () => {
      if (typeof window !== "undefined") {
        const win = window as unknown as {
          __CHAT_HISTORY_CONTEXT__?: unknown;
        };
        delete win.__CHAT_HISTORY_CONTEXT__;
      }
    };
  }, [confirmSession]);

  return (
    <ChatHistoryContext.Provider value={contextValue}>
      {children}
    </ChatHistoryContext.Provider>
  );
};

// Export a hook to use the chat history context
export const useChatHistory = (): ChatHistoryContextType => {
  const context = useContext(ChatHistoryContext);
  if (!context) {
    throw new Error("useChatHistory must be used within a ChatHistoryProvider");
  }
  return context;
};
