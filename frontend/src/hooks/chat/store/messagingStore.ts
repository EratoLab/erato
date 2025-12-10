import { create } from "zustand";

import { createLogger } from "@/utils/debugLogger";

import type {
  Value,
  ToolCallStatus,
  ContentPart,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Message } from "@/types/chat";

const logger = createLogger("STATE", "messagingStore");

// Tool call tracking types
export interface ToolCall {
  id: string;
  name: string;
  status: "proposed" | ToolCallStatus;
  input?: Value | null;
  output?: Value | null;
  progressMessage?: string | null;
}

// Streaming state
export interface StreamingState {
  isStreaming: boolean;
  isFinalizing: boolean; // True during post-streaming refetch/cleanup phase
  currentMessageId: string | null;
  content: ContentPart[];
  createdAt: string | null; // Timestamp for message ordering
  // Add tool call tracking
  toolCalls: Record<string, ToolCall>; // keyed by tool_call_id
}

// Add user messages to the store
export interface MessagingStore {
  streaming: StreamingState;
  userMessages: Record<string, Message>; // Store user messages keyed by a temporary ID
  error: Error | null; // <--- Add error state
  isAwaitingFirstStreamChunkForNewChat: boolean; // New state for pre-navigation hold
  newlyCreatedChatId: string | null; // To store the ID of a newly created chat
  isInNavigationTransition: boolean; // Flag to preserve state during explicit navigation
  setStreaming: (state: Partial<StreamingState>) => void;
  resetStreaming: () => void;
  addUserMessage: (message: Message) => void;
  clearUserMessages: () => void;
  // New method to only clear messages that are not in sending state
  clearCompletedUserMessages: () => void;
  setError: (error: Error | null) => void; // <--- Add setError action
  setAwaitingFirstStreamChunkForNewChat: (isAwaiting: boolean) => void; // Action for the new state
  setNewlyCreatedChatIdInStore: (chatId: string | null) => void; // Action for newlyCreatedChatId
  setNavigationTransition: (inTransition: boolean) => void; // Action for navigation transition flag
}

// Initial streaming state
export const initialStreamingState: StreamingState = {
  isStreaming: false,
  isFinalizing: false,
  currentMessageId: null,
  content: [],
  createdAt: null,
  toolCalls: {},
};

// Create a store for messaging state
export const useMessagingStore = create<MessagingStore>((set) => {
  return {
    streaming: initialStreamingState,
    userMessages: {},
    error: null, // <--- Initialize error state
    isAwaitingFirstStreamChunkForNewChat: false, // Initialize new state
    newlyCreatedChatId: null, // Initialize newlyCreatedChatId
    isInNavigationTransition: false, // Initialize navigation transition flag
    setStreaming: (update) =>
      set((prev) => {
        const newState = { ...prev.streaming, ...update };
        if (process.env.NODE_ENV === "development") {
          logger.log("setStreaming called.", {
            prevStreaming: prev.streaming,
            update,
            newStreaming: newState,
          });
        }
        return {
          ...prev,
          streaming: newState,
        };
      }),
    resetStreaming: () => {
      set((prev) => {
        if (process.env.NODE_ENV === "development") {
          logger.log("resetStreaming called.", {
            prevStreaming: prev.streaming,
            newStreaming: initialStreamingState,
          });
        }
        return { ...prev, streaming: initialStreamingState };
      });
    },
    addUserMessage: (message) =>
      set((prev) => {
        const newUserMessages = { ...prev.userMessages, [message.id]: message };
        if (process.env.NODE_ENV === "development") {
          logger.log("addUserMessage called.", {
            messageId: message.id,
            newUserMessagesCount: Object.keys(newUserMessages).length,
          });
        }
        return {
          ...prev,
          userMessages: newUserMessages,
        };
      }),
    clearUserMessages: () => {
      set((prev) => {
        if (process.env.NODE_ENV === "development") {
          logger.log("clearUserMessages called.", {
            prevUserMessagesCount: Object.keys(prev.userMessages).length,
          });
        }
        return { ...prev, userMessages: {} };
      });
    },
    // New method that only clears messages that are not in sending state
    clearCompletedUserMessages: () => {
      set((prev) => {
        const originalUserMessages = prev.userMessages;
        if (Object.keys(originalUserMessages).length === 0) {
          // No log needed here as it's a no-op, returning prev state.
          return prev;
        }

        const nextUserMessages: Record<string, Message> = {};
        let wasAnythingRemoved = false;
        for (const id in originalUserMessages) {
          const msg = originalUserMessages[id];
          if (msg.status === "sending") {
            nextUserMessages[id] = msg;
          } else {
            wasAnythingRemoved = true;
          }
        }

        if (!wasAnythingRemoved) {
          // No log needed here as it's a no-op, returning prev state.
          return prev;
        }
        if (process.env.NODE_ENV === "development") {
          logger.log("clearCompletedUserMessages processed.", {
            prevUserMessagesCount: Object.keys(originalUserMessages).length,
            nextUserMessagesCount: Object.keys(nextUserMessages).length,
            removedCount:
              Object.keys(originalUserMessages).length -
              Object.keys(nextUserMessages).length,
          });
        }
        return { ...prev, userMessages: nextUserMessages };
      });
    },
    setError: (error) =>
      set((prev) => {
        if (process.env.NODE_ENV === "development") {
          logger.log("setError called.", {
            prevError: prev.error,
            newError: error,
          });
        }
        return { ...prev, error };
      }),
    setAwaitingFirstStreamChunkForNewChat: (isAwaiting) =>
      set((prev) => {
        if (process.env.NODE_ENV === "development") {
          logger.log("setAwaitingFirstStreamChunkForNewChat called.", {
            prevIsAwaiting: prev.isAwaitingFirstStreamChunkForNewChat,
            newIsAwaiting: isAwaiting,
          });
        }
        return {
          ...prev,
          isAwaitingFirstStreamChunkForNewChat: isAwaiting,
        };
      }),
    setNewlyCreatedChatIdInStore: (chatId) =>
      set((prev) => {
        if (process.env.NODE_ENV === "development") {
          logger.log("setNewlyCreatedChatIdInStore called.", {
            prevNewlyCreatedChatId: prev.newlyCreatedChatId,
            newNewlyCreatedChatId: chatId,
          });
        }
        return {
          ...prev,
          newlyCreatedChatId: chatId,
        };
      }),
    setNavigationTransition: (inTransition) =>
      set((prev) => {
        if (process.env.NODE_ENV === "development") {
          logger.log("setNavigationTransition called.", {
            prevIsInNavigationTransition: prev.isInNavigationTransition,
            newIsInNavigationTransition: inTransition,
          });
        }
        return {
          ...prev,
          isInNavigationTransition: inTransition,
        };
      }),
  };
});
