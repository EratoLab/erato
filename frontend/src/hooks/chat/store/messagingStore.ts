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
  setStreaming: (state: Partial<StreamingState>) => void;
  resetStreaming: () => void;
  addUserMessage: (message: Message) => void;
  clearUserMessages: () => void;
  // New method to only clear messages that are not in sending state
  clearCompletedUserMessages: () => void;
  setError: (error: Error | null) => void; // <--- Add setError action
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
    setStreaming: (state) =>
      set((prev) => {
        return {
          ...prev,
          streaming: { ...prev.streaming, ...state },
        };
      }),
    resetStreaming: () => {
      set({ streaming: initialStreamingState });
    },
    addUserMessage: (message) =>
      set((prev) => {
        return {
          ...prev,
          userMessages: { ...prev.userMessages, [message.id]: message },
        };
      }),
    clearUserMessages: () => {
      set({ userMessages: {} });
    },
    // New method that only clears messages that are not in sending state
    clearCompletedUserMessages: () => {
      set((prev) => {
        const filteredMessages = Object.entries(prev.userMessages).reduce(
          (acc, [id, msg]) => {
            // Keep messages that are still in sending state
            if (msg.status === "sending") {
              acc[id] = msg;
            }
            return acc;
          },
          {} as Record<string, Message>,
        );
        return { ...prev, userMessages: filteredMessages };
      });
    },
    setError: (error) => set({ error }), // <--- Implement setError
  };
});
