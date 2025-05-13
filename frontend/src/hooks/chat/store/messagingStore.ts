import { create } from "zustand";

import type { Message } from "@/types/chat";

// Streaming state
export interface StreamingState {
  isStreaming: boolean;
  currentMessageId: string | null;
  content: string;
}

// Add user messages to the store
export interface MessagingStore {
  streaming: StreamingState;
  userMessages: Record<string, Message>; // Store user messages keyed by a temporary ID
  error: Error | null; // <--- Add error state
  isAwaitingFirstStreamChunkForNewChat: boolean; // New state for pre-navigation hold
  newlyCreatedChatId: string | null; // To store the ID of a newly created chat
  setStreaming: (state: Partial<StreamingState>) => void;
  resetStreaming: () => void;
  addUserMessage: (message: Message) => void;
  clearUserMessages: () => void;
  // New method to only clear messages that are not in sending state
  clearCompletedUserMessages: () => void;
  setError: (error: Error | null) => void; // <--- Add setError action
  setAwaitingFirstStreamChunkForNewChat: (isAwaiting: boolean) => void; // Action for the new state
  setNewlyCreatedChatIdInStore: (chatId: string | null) => void; // Action for newlyCreatedChatId
}

// Initial streaming state
export const initialStreamingState: StreamingState = {
  isStreaming: false,
  currentMessageId: null,
  content: "",
};

// Create a store for messaging state
export const useMessagingStore = create<MessagingStore>((set) => {
  return {
    streaming: initialStreamingState,
    userMessages: {},
    error: null, // <--- Initialize error state
    isAwaitingFirstStreamChunkForNewChat: false, // Initialize new state
    newlyCreatedChatId: null, // Initialize newlyCreatedChatId
    setStreaming: (update) =>
      set((prev) => {
        const newState = { ...prev.streaming, ...update };
        if (process.env.NODE_ENV === "development") {
          console.log("[DEBUG_STORE] messagingStore: setStreaming called.", {
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
          console.log("[DEBUG_STORE] messagingStore: resetStreaming called.", {
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
          console.log("[DEBUG_STORE] messagingStore: addUserMessage called.", {
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
          console.log(
            "[DEBUG_STORE] messagingStore: clearUserMessages called.",
            { prevUserMessagesCount: Object.keys(prev.userMessages).length },
          );
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
          console.log(
            "[DEBUG_STORE] messagingStore: clearCompletedUserMessages processed.",
            {
              prevUserMessagesCount: Object.keys(originalUserMessages).length,
              nextUserMessagesCount: Object.keys(nextUserMessages).length,
              removedCount:
                Object.keys(originalUserMessages).length -
                Object.keys(nextUserMessages).length,
            },
          );
        }
        return { ...prev, userMessages: nextUserMessages };
      });
    },
    setError: (error) =>
      set((prev) => {
        if (process.env.NODE_ENV === "development") {
          console.log("[DEBUG_STORE] messagingStore: setError called.", {
            prevError: prev.error,
            newError: error,
          });
        }
        return { ...prev, error };
      }),
    setAwaitingFirstStreamChunkForNewChat: (isAwaiting) =>
      set((prev) => {
        if (process.env.NODE_ENV === "development") {
          console.log(
            "[DEBUG_STORE] messagingStore: setAwaitingFirstStreamChunkForNewChat called.",
            {
              prevIsAwaiting: prev.isAwaitingFirstStreamChunkForNewChat,
              newIsAwaiting: isAwaiting,
            },
          );
        }
        return {
          ...prev,
          isAwaitingFirstStreamChunkForNewChat: isAwaiting,
        };
      }),
    setNewlyCreatedChatIdInStore: (chatId) =>
      set((prev) => {
        if (process.env.NODE_ENV === "development") {
          console.log(
            "[DEBUG_STORE] messagingStore: setNewlyCreatedChatIdInStore called.",
            {
              prevNewlyCreatedChatId: prev.newlyCreatedChatId,
              newNewlyCreatedChatId: chatId,
            },
          );
        }
        return {
          ...prev,
          newlyCreatedChatId: chatId,
        };
      }),
  };
});
