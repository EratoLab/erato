import React, { useContext, useCallback, useMemo } from "react";
import {
  useChats,
  useMessages,
} from "../../lib/generated/v1betaApi/v1betaApiComponents";
import * as reactQuery from "@tanstack/react-query";
import { useMap } from "react-use";
import type { ChatSession } from "../../types/chat";
import type { ChatHistoryContextType } from "../../types/chat-history";
import { ChatHistoryContext } from "../../contexts/ChatHistoryContext";

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

  // TODO: @backend - Add proper query params for filtering chats
  const { isLoading: isLoadingChats } = useChats(
    {},
    {
      staleTime: 30000,
      gcTime: 5 * 60 * 1000,
    },
  );

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

  // TODO: @backend - Add API mutation for creating sessions
  const createSession = useCallback(() => {
    const newSession: ChatSession = {
      id: new Date().toISOString(),
      title: "New Chat",
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    set(newSession.id, newSession);
    setCurrentSessionId(newSession.id);
    return newSession.id;
  }, [set, setCurrentSessionId]);

  // TODO: @backend - Add API mutation for updating sessions
  const updateSession = useCallback(
    (sessionId: string, updates: Partial<ChatSession>) => {
      const currentSession = sessions[sessionId];
      if (currentSession) {
        set(sessionId, {
          ...currentSession,
          ...updates,
          updatedAt: new Date(),
        });
      }
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

  const contextValue = useMemo(
    () => ({
      sessions: sortedSessions,
      currentSessionId,
      createSession,
      updateSession,
      deleteSession,
      switchSession,
      getCurrentSession,
      isLoading: isLoadingChats || isLoadingMessages,
    }),
    [
      sortedSessions,
      currentSessionId,
      createSession,
      updateSession,
      deleteSession,
      switchSession,
      getCurrentSession,
      isLoadingChats,
      isLoadingMessages,
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
