/* eslint-disable @typescript-eslint/no-unnecessary-condition */
import { create } from "zustand";
import { devtools } from "zustand/middleware";

import { mergeDisplayMessages } from "@/utils/chat/messageUtils";
import { createLogger } from "@/utils/debugLogger";

import type {
  Value,
  ToolCallStatus,
  ContentPart,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Message } from "@/types/chat";

const logger = createLogger("STATE", "messagingStore");
export const NEW_CHAT_STREAM_KEY = "__new_chat__";
const EMPTY_MESSAGES: Record<string, Message> = {};

export const getStreamKey = (chatId: string | null | undefined): string => {
  return chatId ?? NEW_CHAT_STREAM_KEY;
};

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
  streamingByKey: Record<string, StreamingState>;
  apiMessagesByKey: Record<string, Record<string, Message>>;
  streamKeyAliases: Record<string, string>;
  activeStreamKey: string;
  userMessages: Record<string, Message>; // Backward-compat mirror of active stream key user messages
  userMessagesByKey: Record<string, Record<string, Message>>;
  error: Error | null; // <--- Add error state
  isAwaitingFirstStreamChunkForNewChat: boolean; // New state for pre-navigation hold
  newlyCreatedChatId: string | null; // To store the ID of a newly created chat
  isInNavigationTransition: boolean; // Flag to preserve state during explicit navigation
  sseAbortCallback: (() => void) | null; // Backward-compat alias for active stream key callback
  sseAbortCallbacksByKey: Record<string, () => void>;
  getStreaming: (streamKey?: string | null) => StreamingState;
  setActiveStreamKey: (streamKey: string) => void;
  moveStreamingState: (fromKey: string, toKey: string) => void;
  setStreaming: (
    state: Partial<StreamingState>,
    streamKey?: string | null,
  ) => void;
  resetStreaming: (streamKey?: string | null) => void;
  clearAllStreaming: () => void;
  getApiMessages: (streamKey?: string | null) => Record<string, Message>;
  setApiMessages: (messages: Message[], streamKey?: string | null) => void;
  clearApiMessages: (streamKey?: string | null) => void;
  clearAllApiMessages: () => void;
  getUserMessages: (streamKey?: string | null) => Record<string, Message>;
  getRenderableMessages: (
    streamKey?: string | null,
    options?: { includeApiMessages?: boolean },
  ) => Record<string, Message>;
  addUserMessage: (message: Message, streamKey?: string | null) => void;
  clearUserMessages: (streamKey?: string | null) => void;
  // New method to only clear messages that are not in sending state
  clearCompletedUserMessages: (streamKey?: string | null) => void;
  setError: (error: Error | null) => void; // <--- Add setError action
  setAwaitingFirstStreamChunkForNewChat: (isAwaiting: boolean) => void; // Action for the new state
  setNewlyCreatedChatIdInStore: (chatId: string | null) => void; // Action for newlyCreatedChatId
  setNavigationTransition: (inTransition: boolean) => void; // Action for navigation transition flag
  setSSEAbortCallback: (
    callback: (() => void) | null,
    streamKey?: string | null,
  ) => void; // Store SSE abort callback
  abortActiveSSE: (streamKey?: string | null) => void; // Abort any active SSE connection
  abortAllSSE: () => void;
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
export const useMessagingStore = create<MessagingStore>()(
  devtools(
    (set, get) => {
      const resolveStreamKey = (streamKey?: string | null) =>
        streamKey ?? get().activeStreamKey;
      const resolveStreamKeyFromState = (
        state: Pick<MessagingStore, "streamKeyAliases">,
        streamKey: string,
      ) => {
        let resolvedKey = streamKey;
        const visited = new Set<string>();
        while (
          state.streamKeyAliases[resolvedKey] &&
          !visited.has(resolvedKey)
        ) {
          visited.add(resolvedKey);
          resolvedKey = state.streamKeyAliases[resolvedKey];
        }
        return resolvedKey;
      };
      const getStreamingForKey = (state: MessagingStore, streamKey: string) =>
        state.streamingByKey[resolveStreamKeyFromState(state, streamKey)] ??
        initialStreamingState;
      const getApiMessagesForKey = (state: MessagingStore, streamKey: string) =>
        state.apiMessagesByKey[resolveStreamKeyFromState(state, streamKey)] ??
        EMPTY_MESSAGES;
      const getUserMessagesForKey = (
        state: MessagingStore,
        streamKey: string,
      ) =>
        state.userMessagesByKey[resolveStreamKeyFromState(state, streamKey)] ??
        EMPTY_MESSAGES;
      const buildRenderableMessages = (
        state: MessagingStore,
        streamKey: string,
        includeApiMessages = true,
      ): Record<string, Message> => {
        const currentStreaming = getStreamingForKey(state, streamKey);
        const localUserMessages = Object.values(
          getUserMessagesForKey(state, streamKey),
        );
        const apiMessages = includeApiMessages
          ? Object.values(getApiMessagesForKey(state, streamKey))
          : [];
        const combinedMessages = mergeDisplayMessages(
          apiMessages,
          localUserMessages,
        );

        if (!currentStreaming.currentMessageId) {
          return combinedMessages;
        }

        if (
          combinedMessages[currentStreaming.currentMessageId] &&
          !currentStreaming.isStreaming
        ) {
          return combinedMessages;
        }

        return {
          ...combinedMessages,
          [currentStreaming.currentMessageId]: {
            id: currentStreaming.currentMessageId,
            content: currentStreaming.content,
            role: "assistant",
            createdAt: currentStreaming.createdAt ?? new Date().toISOString(),
            status: currentStreaming.isStreaming ? "sending" : "complete",
          },
        };
      };

      return {
        streaming: initialStreamingState,
        streamingByKey: {},
        apiMessagesByKey: {},
        streamKeyAliases: {},
        activeStreamKey: NEW_CHAT_STREAM_KEY,
        userMessages: {},
        userMessagesByKey: {},
        error: null, // <--- Initialize error state
        isAwaitingFirstStreamChunkForNewChat: false, // Initialize new state
        newlyCreatedChatId: null, // Initialize newlyCreatedChatId
        isInNavigationTransition: false, // Initialize navigation transition flag
        sseAbortCallback: null, // Initialize SSE abort callback
        sseAbortCallbacksByKey: {},
        getStreaming: (streamKey) => {
          const state = get();
          return getStreamingForKey(state, resolveStreamKey(streamKey));
        },
        setActiveStreamKey: (streamKey) =>
          set(
            (prev) => {
              const resolvedKey = resolveStreamKeyFromState(prev, streamKey);
              const nextStreaming = getStreamingForKey(prev, streamKey);
              if (process.env.NODE_ENV === "development") {
                logger.log("setActiveStreamKey called.", {
                  prevActiveStreamKey: prev.activeStreamKey,
                  nextActiveStreamKey: streamKey,
                  resolvedKey,
                });
              }
              return {
                ...prev,
                activeStreamKey: streamKey,
                streaming: nextStreaming,
                userMessages: getUserMessagesForKey(prev, streamKey),
                sseAbortCallback:
                  prev.sseAbortCallbacksByKey[resolvedKey] ?? null,
              };
            },
            false,
            "messaging/setActiveStreamKey",
          ),
        moveStreamingState: (fromKey, toKey) =>
          set(
            (prev) => {
              if (!fromKey || !toKey || fromKey === toKey) {
                return prev;
              }
              const fromStreaming = prev.streamingByKey[fromKey];
              if (!fromStreaming) {
                return prev;
              }

              const nextStreamingByKey = { ...prev.streamingByKey };
              nextStreamingByKey[toKey] = fromStreaming;
              delete nextStreamingByKey[fromKey];
              const nextApiMessagesByKey = { ...prev.apiMessagesByKey };
              const fromApiMessages = nextApiMessagesByKey[fromKey];
              if (fromApiMessages) {
                nextApiMessagesByKey[toKey] = fromApiMessages;
                delete nextApiMessagesByKey[fromKey];
              }
              const nextUserMessagesByKey = { ...prev.userMessagesByKey };
              const fromUserMessages = nextUserMessagesByKey[fromKey];
              if (fromUserMessages) {
                nextUserMessagesByKey[toKey] = fromUserMessages;
                delete nextUserMessagesByKey[fromKey];
              }
              const nextAliases = {
                ...prev.streamKeyAliases,
                [fromKey]: toKey,
              };

              const nextAbortCallbacks = { ...prev.sseAbortCallbacksByKey };
              const fromAbort = nextAbortCallbacks[fromKey];
              if (fromAbort) {
                nextAbortCallbacks[toKey] = fromAbort;
                delete nextAbortCallbacks[fromKey];
              }

              const activeStreamKey = prev.activeStreamKey;
              const activeResolvedKey = resolveStreamKeyFromState(
                { streamKeyAliases: nextAliases },
                activeStreamKey,
              );

              return {
                ...prev,
                activeStreamKey,
                streamKeyAliases: nextAliases,
                streamingByKey: nextStreamingByKey,
                apiMessagesByKey: nextApiMessagesByKey,
                userMessagesByKey: nextUserMessagesByKey,
                sseAbortCallbacksByKey: nextAbortCallbacks,
                streaming:
                  nextStreamingByKey[activeResolvedKey] ??
                  initialStreamingState,
                userMessages: nextUserMessagesByKey[activeResolvedKey] ?? {},
                sseAbortCallback: nextAbortCallbacks[activeResolvedKey] ?? null,
              };
            },
            false,
            "messaging/moveStreamingState",
          ),
        setStreaming: (update, streamKey) =>
          set(
            (prev) => {
              const inputKey = resolveStreamKey(streamKey);
              const resolvedKey = resolveStreamKeyFromState(prev, inputKey);
              const prevStreaming = getStreamingForKey(prev, resolvedKey);
              const newState = { ...prevStreaming, ...update };
              const nextStreamingByKey = {
                ...prev.streamingByKey,
                [resolvedKey]: newState,
              };
              if (process.env.NODE_ENV === "development") {
                logger.log("setStreaming called.", {
                  streamKey: resolvedKey,
                  prevStreaming,
                  update,
                  newStreaming: newState,
                });
              }
              const activeResolvedKey = resolveStreamKeyFromState(
                prev,
                prev.activeStreamKey,
              );
              const isActive = activeResolvedKey === resolvedKey;
              return {
                ...prev,
                streamingByKey: nextStreamingByKey,
                streaming: isActive ? newState : prev.streaming,
              };
            },
            false,
            "messaging/setStreaming",
          ),
        resetStreaming: (streamKey) => {
          set(
            (prev) => {
              const inputKey = resolveStreamKey(streamKey);
              const resolvedKey = resolveStreamKeyFromState(prev, inputKey);
              const nextStreamingByKey = { ...prev.streamingByKey };
              delete nextStreamingByKey[resolvedKey];
              const nextAliases = { ...prev.streamKeyAliases };
              if (inputKey !== resolvedKey) {
                delete nextAliases[inputKey];
              }
              if (process.env.NODE_ENV === "development") {
                logger.log("resetStreaming called.", {
                  streamKey: resolvedKey,
                  prevStreaming: getStreamingForKey(prev, resolvedKey),
                  newStreaming: initialStreamingState,
                });
              }
              const activeResolvedKey = resolveStreamKeyFromState(
                { streamKeyAliases: nextAliases },
                prev.activeStreamKey,
              );
              const isActive = activeResolvedKey === resolvedKey;
              return {
                ...prev,
                streamKeyAliases: nextAliases,
                streamingByKey: nextStreamingByKey,
                streaming: isActive ? initialStreamingState : prev.streaming,
                userMessages: isActive
                  ? getUserMessagesForKey(prev, prev.activeStreamKey)
                  : prev.userMessages,
              };
            },
            false,
            "messaging/resetStreaming",
          );
        },
        clearAllStreaming: () => {
          set(
            (prev) => ({
              ...prev,
              streaming: initialStreamingState,
              streamingByKey: {},
              streamKeyAliases: {},
            }),
            false,
            "messaging/clearAllStreaming",
          );
        },
        getApiMessages: (streamKey) => {
          const state = get();
          return getApiMessagesForKey(state, resolveStreamKey(streamKey));
        },
        setApiMessages: (messages, streamKey) =>
          set(
            (prev) => {
              const inputKey = resolveStreamKey(streamKey);
              const resolvedKey = resolveStreamKeyFromState(prev, inputKey);
              const nextById: Record<string, Message> = {};
              messages.forEach((message) => {
                nextById[message.id] = message;
              });

              return {
                ...prev,
                apiMessagesByKey: {
                  ...prev.apiMessagesByKey,
                  [resolvedKey]: nextById,
                },
              };
            },
            false,
            "messaging/setApiMessages",
          ),
        clearApiMessages: (streamKey) =>
          set(
            (prev) => {
              const inputKey = resolveStreamKey(streamKey);
              const resolvedKey = resolveStreamKeyFromState(prev, inputKey);
              const nextApiMessagesByKey = { ...prev.apiMessagesByKey };
              delete nextApiMessagesByKey[resolvedKey];
              return {
                ...prev,
                apiMessagesByKey: nextApiMessagesByKey,
              };
            },
            false,
            "messaging/clearApiMessages",
          ),
        clearAllApiMessages: () =>
          set(
            (prev) => ({ ...prev, apiMessagesByKey: {} }),
            false,
            "messaging/clearAllApiMessages",
          ),
        getUserMessages: (streamKey) => {
          const state = get();
          return getUserMessagesForKey(state, resolveStreamKey(streamKey));
        },
        getRenderableMessages: (streamKey, options) => {
          const state = get();
          const includeApiMessages = options?.includeApiMessages ?? true;
          return buildRenderableMessages(
            state,
            resolveStreamKey(streamKey),
            includeApiMessages,
          );
        },
        addUserMessage: (message, streamKey) =>
          set(
            (prev) => {
              const inputKey = resolveStreamKey(streamKey);
              const resolvedKey = resolveStreamKeyFromState(prev, inputKey);
              const prevByKey = getUserMessagesForKey(prev, resolvedKey);
              const nextByKey = {
                ...prev.userMessagesByKey,
                [resolvedKey]: {
                  ...prevByKey,
                  [message.id]: message,
                },
              };
              const newUserMessages = {
                ...prevByKey,
                [message.id]: message,
              };
              if (process.env.NODE_ENV === "development") {
                logger.log("addUserMessage called.", {
                  streamKey: resolvedKey,
                  messageId: message.id,
                  newUserMessagesCount: Object.keys(newUserMessages).length,
                });
              }
              const activeResolvedKey = resolveStreamKeyFromState(
                prev,
                prev.activeStreamKey,
              );
              return {
                ...prev,
                userMessagesByKey: nextByKey,
                userMessages:
                  activeResolvedKey === resolvedKey
                    ? newUserMessages
                    : prev.userMessages,
              };
            },
            false,
            "messaging/addUserMessage",
          ),
        clearUserMessages: (streamKey) => {
          set(
            (prev) => {
              if (streamKey) {
                const inputKey = resolveStreamKey(streamKey);
                const resolvedKey = resolveStreamKeyFromState(prev, inputKey);
                const nextUserMessagesByKey = { ...prev.userMessagesByKey };
                const prevCount = Object.keys(
                  nextUserMessagesByKey[resolvedKey] ?? {},
                ).length;
                delete nextUserMessagesByKey[resolvedKey];
                const activeResolvedKey = resolveStreamKeyFromState(
                  prev,
                  prev.activeStreamKey,
                );
                if (process.env.NODE_ENV === "development") {
                  logger.log("clearUserMessages called.", {
                    streamKey: resolvedKey,
                    prevUserMessagesCount: prevCount,
                  });
                }
                return {
                  ...prev,
                  userMessagesByKey: nextUserMessagesByKey,
                  userMessages:
                    activeResolvedKey === resolvedKey ? {} : prev.userMessages,
                };
              }
              if (process.env.NODE_ENV === "development") {
                logger.log("clearUserMessages called.", {
                  prevUserMessagesCount: Object.keys(prev.userMessages).length,
                });
              }
              return { ...prev, userMessages: {}, userMessagesByKey: {} };
            },
            false,
            "messaging/clearUserMessages",
          );
        },
        // New method that only clears messages that are not in sending state
        clearCompletedUserMessages: (streamKey) => {
          set(
            (prev) => {
              const processForKey = (
                originalUserMessages: Record<string, Message>,
              ) => {
                const nextUserMessages: Record<string, Message> = {};
                let wasAnythingRemoved = false;
                for (const id in originalUserMessages) {
                  const msg = originalUserMessages[id];
                  const isTemporaryUserMessage =
                    msg.role === "user" && msg.id.startsWith("temp-user-");
                  if (msg.status === "sending" || !isTemporaryUserMessage) {
                    nextUserMessages[id] = msg;
                  } else {
                    wasAnythingRemoved = true;
                  }
                }
                return { nextUserMessages, wasAnythingRemoved };
              };

              if (streamKey) {
                const inputKey = resolveStreamKey(streamKey);
                const resolvedKey = resolveStreamKeyFromState(prev, inputKey);
                const originalUserMessages = getUserMessagesForKey(
                  prev,
                  resolvedKey,
                );
                if (Object.keys(originalUserMessages).length === 0) {
                  return prev;
                }
                const { nextUserMessages, wasAnythingRemoved } =
                  processForKey(originalUserMessages);
                if (!wasAnythingRemoved) {
                  return prev;
                }
                const nextByKey = {
                  ...prev.userMessagesByKey,
                  [resolvedKey]: nextUserMessages,
                };
                const activeResolvedKey = resolveStreamKeyFromState(
                  prev,
                  prev.activeStreamKey,
                );
                return {
                  ...prev,
                  userMessagesByKey: nextByKey,
                  userMessages:
                    activeResolvedKey === resolvedKey
                      ? nextUserMessages
                      : prev.userMessages,
                };
              }

              const nextByKey: Record<string, Record<string, Message>> = {};
              let removedCount = 0;
              for (const [key, userMessagesForKey] of Object.entries(
                prev.userMessagesByKey,
              )) {
                const { nextUserMessages, wasAnythingRemoved } =
                  processForKey(userMessagesForKey);
                nextByKey[key] = nextUserMessages;
                if (wasAnythingRemoved) {
                  removedCount += 1;
                }
              }
              if (removedCount === 0) {
                return prev;
              }
              const activeResolvedKey = resolveStreamKeyFromState(
                prev,
                prev.activeStreamKey,
              );
              return {
                ...prev,
                userMessagesByKey: nextByKey,
                userMessages: nextByKey[activeResolvedKey] ?? {},
              };
            },
            false,
            "messaging/clearCompletedUserMessages",
          );
        },
        setError: (error) =>
          set(
            (prev) => {
              if (process.env.NODE_ENV === "development") {
                logger.log("setError called.", {
                  prevError: prev.error,
                  newError: error,
                });
              }
              return { ...prev, error };
            },
            false,
            "messaging/setError",
          ),
        setAwaitingFirstStreamChunkForNewChat: (isAwaiting) =>
          set(
            (prev) => {
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
            },
            false,
            "messaging/setAwaitingFirstStreamChunkForNewChat",
          ),
        setNewlyCreatedChatIdInStore: (chatId) =>
          set(
            (prev) => {
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
            },
            false,
            "messaging/setNewlyCreatedChatIdInStore",
          ),
        setNavigationTransition: (inTransition) =>
          set(
            (prev) => {
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
            },
            false,
            "messaging/setNavigationTransition",
          ),
        setSSEAbortCallback: (callback, streamKey) =>
          set(
            (prev) => {
              const inputKey = resolveStreamKey(streamKey);
              const resolvedKey = resolveStreamKeyFromState(prev, inputKey);
              const nextCallbacks = { ...prev.sseAbortCallbacksByKey };
              if (callback) {
                nextCallbacks[resolvedKey] = callback;
              } else {
                delete nextCallbacks[resolvedKey];
              }
              const activeResolvedKey = resolveStreamKeyFromState(
                prev,
                prev.activeStreamKey,
              );
              const isActive = activeResolvedKey === resolvedKey;
              return {
                ...prev,
                sseAbortCallbacksByKey: nextCallbacks,
                sseAbortCallback: isActive
                  ? (callback ?? null)
                  : prev.sseAbortCallback,
              };
            },
            false,
            "messaging/setSSEAbortCallback",
          ),
        abortActiveSSE: (streamKey) => {
          const state = get();
          const resolvedKey = resolveStreamKeyFromState(
            state,
            resolveStreamKey(streamKey),
          );
          const callback = state.sseAbortCallbacksByKey[resolvedKey];
          if (callback) {
            if (process.env.NODE_ENV === "development") {
              logger.log("abortActiveSSE: Aborting SSE connection", {
                streamKey: resolvedKey,
              });
            }
            callback();
            get().setSSEAbortCallback(null, resolvedKey);
          }
        },
        abortAllSSE: () => {
          const state = get();
          Object.entries(state.sseAbortCallbacksByKey).forEach(
            ([streamKey, callback]) => {
              if (process.env.NODE_ENV === "development") {
                logger.log("abortAllSSE: Aborting SSE connection", {
                  streamKey,
                });
              }
              callback();
            },
          );
          set(
            (prev) => ({
              ...prev,
              sseAbortCallbacksByKey: {},
              sseAbortCallback: null,
            }),
            false,
            "messaging/abortAllSSE",
          );
        },
      };
    },
    {
      name: "Messaging Store",
      store: "messaging-store",
      enabled: process.env.NODE_ENV === "development",
    },
  ),
);
