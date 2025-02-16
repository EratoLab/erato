import { createContext } from "react";
import type { ChatHistoryContextType } from "../types/chat-history";

export const ChatHistoryContext = createContext<
  ChatHistoryContextType | undefined
>(undefined);
