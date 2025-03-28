/**
 * Centralized message store using Zustand
 */
import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

import type {
  Message,
  MessageMap,
  MessageStatus,
} from "../types/message.types";
import type { StreamState, StreamingStatus } from "../types/streaming.types";

/**
 * The unified message store state
 */
export interface MessagingState {
  // Messages and chat state
  messages: MessageMap;
  messageOrder: string[];
  currentChatId: string | null;

  // Streaming state
  streaming: StreamState;

  // Actions
  setCurrentChatId: (chatId: string | null) => void;

  // Message actions
  addMessage: (message: Message) => void;
  updateMessage: (id: string, updates: Partial<Message>) => void;
  setMessageStatus: (id: string, status: MessageStatus) => void;
  removeMessage: (id: string) => void;
  resetMessages: () => void;

  // Content actions
  appendContent: (messageId: string, content: string) => void;

  // Streaming actions
  setStreamingStatus: (status: StreamingStatus) => void;
  setStreaming: (updates: Partial<StreamState>) => void;
  resetStreaming: () => void;
}

// Initial state for the streaming part
const initialStreamState: StreamState = {
  status: "idle",
  messageId: null,
  content: "",
};

/**
 * Create the message store with Zustand
 */
export const useMessageStore = create<MessagingState>()(
  // Add middlewares
  devtools(
    immer((set) => ({
      // Initial state
      messages: {},
      messageOrder: [],
      currentChatId: null,
      streaming: initialStreamState,

      // Set the current chat ID
      setCurrentChatId: (chatId) =>
        set({ currentChatId: chatId }, false, "setCurrentChatId"),

      // Add a new message to the store
      addMessage: (message) =>
        set(
          (state) => {
            state.messages[message.id] = message;
            state.messageOrder.push(message.id);
          },
          false,
          "addMessage",
        ),

      // Update an existing message
      updateMessage: (id, updates) =>
        set(
          (state) => {
            if (state.messages[id]) {
              state.messages[id] = { ...state.messages[id], ...updates };
            }
          },
          false,
          "updateMessage",
        ),

      // Set the status of a message
      setMessageStatus: (id, status) =>
        set(
          (state) => {
            if (state.messages[id]) {
              state.messages[id].status = status;
            }
          },
          false,
          "setMessageStatus",
        ),

      // Remove a message from the store
      removeMessage: (id) =>
        set(
          (state) => {
            if (state.messages[id]) {
              delete state.messages[id];
              state.messageOrder = state.messageOrder.filter(
                (messageId: string) => messageId !== id,
              );
            }
          },
          false,
          "removeMessage",
        ),

      // Reset all messages
      resetMessages: () =>
        set({ messages: {}, messageOrder: [] }, false, "resetMessages"),

      // Append content to a message
      appendContent: (messageId, content) =>
        set(
          (state) => {
            // Update message content if it exists
            if (state.messages[messageId]) {
              state.messages[messageId].content += content;

              // If this is the streaming message, also update streaming content
              if (state.streaming.messageId === messageId) {
                state.streaming.content += content;
              }
            }
          },
          false,
          "appendContent",
        ),

      // Set streaming status
      setStreamingStatus: (status) =>
        set(
          (state) => {
            state.streaming.status = status;
          },
          false,
          "setStreamingStatus",
        ),

      // Update streaming state
      setStreaming: (updates) =>
        set(
          (state) => {
            state.streaming = { ...state.streaming, ...updates };
          },
          false,
          "setStreaming",
        ),

      // Reset streaming state
      resetStreaming: () =>
        set(
          (state) => {
            state.streaming = initialStreamState;
          },
          false,
          "resetStreaming",
        ),
    })),
  ),
);
