import type { ChatSession } from "./chat";

export interface ChatHistoryContextType {
  sessions: ChatSession[];
  currentSessionId: string | null;
  createSession: () => string;
  updateSession: (sessionId: string, updates: Partial<ChatSession>) => void;
  deleteSession: (sessionId: string) => void;
  switchSession: (sessionId: string) => void;
  getCurrentSession: () => ChatSession | null;
  confirmSession: (tempId: string, permanentId: string) => void;
  loadMoreChats: () => Promise<void>;
  hasMoreChats: boolean;
  isLoading: boolean;
  error?: Error;
}
