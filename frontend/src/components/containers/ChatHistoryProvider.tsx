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
  useRecentChats,
} from "../../lib/generated/v1betaApi/v1betaApiComponents";

import type { ChatHistoryContextType } from "../../types/chat-history";
import type { RecentChat } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ChatSession } from "@/types/chat";

interface ChatHistoryProviderProps extends React.PropsWithChildren {
  initialSessions?: ChatSession[];
  initialSessionId?: string;
}

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
      Object.values(sessions).sort(
        (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
      ),
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

  // Replace the deprecated useChats with useRecentChats
  const { data: recentChatsResponse, isLoading: isLoadingChats } =
    useRecentChats(
      { queryParams: { limit: 20 } }, // Fetch up to 50 recent chats
      {
        staleTime: 30000,
        gcTime: 5 * 60 * 1000,
      },
    );

  // Sync RecentChat data with sessions state when they load
  useEffect(() => {
    if (recentChatsResponse?.chats && recentChatsResponse.chats.length > 0) {
      recentChatsResponse.chats.forEach((recentChat: RecentChat) => {
        // Check if the key exists in the sessions map
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
  }, [recentChatsResponse, sessions, set]);

  // TODO: @backend - Add sessionId to message query params
  const { isLoading: isLoadingMessages } = useMessages(
    currentSessionId
      ? { queryParams: { sessionId: currentSessionId } }
      : reactQuery.skipToken,
    {
      enabled: !!currentSessionId,
      staleTime: 5000,
      gcTime: 60000,
    },
  );

  // Change error state to match the context type (undefined instead of null)
  const [error, setError] = useState<Error | undefined>(undefined);

  // Add error handling to existing operations
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
          ownerId: "", // Will be set when the chat is confirmed with the first message
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

  // Add a function to replace a temporary session with a permanent one
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
      }
    },
    [sessions, set, setCurrentSessionId, remove],
  );

  // TODO: @backend - Add API mutation for updating sessions
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

  // TODO: @backend - Add API mutation for deleting sessions
  const deleteSession = useCallback(
    (sessionId: string) => {
      remove(sessionId);
      if (currentSessionId === sessionId) {
        setCurrentSessionId(null);
      }
    },
    [currentSessionId, remove, setCurrentSessionId],
  );

  const switchSession = useCallback(
    (sessionId: string) => {
      setCurrentSessionId(sessionId);
    },
    [setCurrentSessionId],
  );

  const getCurrentSession = useCallback(() => {
    return currentSessionId ? (sessions[currentSessionId] ?? null) : null;
  }, [sessions, currentSessionId]);

  // Add a function to load more chats (for pagination)
  const [currentOffset, setCurrentOffset] = useState(0);
  const [hasMoreChats, setHasMoreChats] = useState(true);

  // Update hasMoreChats when we receive a response
  useEffect(() => {
    if (recentChatsResponse?.stats) {
      setHasMoreChats(recentChatsResponse.stats.has_more);
      setCurrentOffset(recentChatsResponse.stats.current_offset);
    }
  }, [recentChatsResponse]);

  const loadMoreChats = useCallback(async () => {
    if (!hasMoreChats || isLoadingChats) return;

    try {
      // Calculate the next offset using the stats
      const nextOffset =
        currentOffset + (recentChatsResponse?.stats.returned_count ?? 20);
      setCurrentOffset(nextOffset);

      // We'll get updated hasMoreChats from the API response
    } catch (e) {
      setError(e instanceof Error ? e : new Error("Failed to load more chats"));
    }
  }, [currentOffset, hasMoreChats, isLoadingChats, recentChatsResponse]);

  // Combine loading states for simpler consumption
  const isLoading = isLoadingChats || isLoadingMessages;

  // Expose the new confirmSession method in the context
  const contextValue = useMemo(
    () => ({
      sessions: sortedSessions,
      currentSessionId,
      createSession,
      updateSession,
      deleteSession,
      switchSession,
      getCurrentSession,
      confirmSession,
      loadMoreChats,
      hasMoreChats,
      isLoading,
      error,
    }),
    [
      sortedSessions,
      currentSessionId,
      createSession,
      updateSession,
      deleteSession,
      switchSession,
      getCurrentSession,
      confirmSession,
      loadMoreChats,
      hasMoreChats,
      isLoading,
      error,
    ],
  );

  return (
    <ChatHistoryContext.Provider value={contextValue}>
      {children}
    </ChatHistoryContext.Provider>
  );
};

export const useChatHistory = (): ChatHistoryContextType => {
  const context = useContext(ChatHistoryContext);
  if (!context) {
    throw new Error("useChatHistory must be used within a ChatHistoryProvider");
  }
  return context;
};
