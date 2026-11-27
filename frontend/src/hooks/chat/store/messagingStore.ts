/* eslint-disable @typescript-eslint/no-unnecessary-condition */
import { create } from "zustand";
import { devtools } from "zustand/middleware";

import { registerWorkInProgress } from "@/lib/chunkLoadRecovery";
import { contentSize, mergeDisplayMessages } from "@/utils/chat/messageUtils";
import { createLogger } from "@/utils/debugLogger";

import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Message } from "@/types/chat";

const logger = createLogger("STATE", "messagingStore");
export const NEW_CHAT_STREAM_KEY = "__new_chat__";
const EMPTY_MESSAGES: Record<string, Message> = {};
const NO_KEPT_ANSWERS: Record<string, KeptAnswer> = {};

export const getStreamKey = (chatId: string | null | undefined): string => {
  return chatId ?? NEW_CHAT_STREAM_KEY;
};

// Streaming state
export interface StreamingState {
  isStreaming: boolean;
  isFinalizing: boolean; // True during post-streaming refetch/cleanup phase
  currentMessageId: string | null;
  content: ContentPart[];
  submissionOutcome?: Message["submission_outcome"];
  createdAt: string | null; // Timestamp for message ordering
  /** Host preparation still running before the request is sent. */
  pendingLabel?: string | null;
}

/** An answer as the reader last saw it, standing in for the server's copy. */
export interface KeptAnswer {
  message: Message;
  /**
   * When the client learnt the server has the answer saved. A copy fetched
   * after that wins, even if shorter; one requested earlier can be stale.
   */
  savedAt: number | null;
}

// Add user messages to the store
export interface MessagingStore {
  streaming: StreamingState;
  streamingByKey: Record<string, StreamingState>;
  apiMessagesByKey: Record<string, Record<string, Message>>;
  /**
   * Answers as the reader last saw them, shown in their own place while the
   * copy there (a refetch that has not caught up, a reattached stream
   * replaying from its start) is shorter, until the server has them saved.
   */
  keptAnswersByKey: Record<string, Record<string, KeptAnswer>>;
  hiddenMessageIdsByKey: Record<string, string[]>;
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
  releaseNewChatStream: () => void;
  setStreaming: (
    state: Partial<StreamingState>,
    streamKey?: string | null,
  ) => void;
  resetStreaming: (streamKey?: string | null) => void;
  /** Keeps the streamed answer on screen until the server's copy replaces it. */
  keepStreamedAnswer: (
    streamKey: string | null | undefined,
    options: { saved: boolean },
  ) => void;
  /** The server has saved these answers (all of the chat's when omitted). */
  markAnswersSaved: (
    streamKey: string | null | undefined,
    messageIds?: string[],
  ) => void;
  clearAllStreaming: () => void;
  getApiMessages: (streamKey?: string | null) => Record<string, Message>;
  getHiddenMessageIds: (streamKey?: string | null) => string[];
  /** `requestedAt`: when the fetch that read `messages` started, if known. */
  setApiMessages: (
    messages: Message[],
    streamKey?: string | null,
    requestedAt?: number,
  ) => void;
  hideMessageIds: (messageIds: string[], streamKey?: string | null) => void;
  clearHiddenMessageIds: (streamKey?: string | null) => void;
  clearApiMessages: (streamKey?: string | null) => void;
  clearAllApiMessages: () => void;
  getUserMessages: (streamKey?: string | null) => Record<string, Message>;
  getRenderableMessages: (
    streamKey?: string | null,
    options?: { includeApiMessages?: boolean },
  ) => Record<string, Message>;
  addUserMessage: (message: Message, streamKey?: string | null) => void;
  removeUserMessages: (messageIds: string[], streamKey?: string | null) => void;
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
      const getHiddenMessageIdsForKey = (
        state: MessagingStore,
        streamKey: string,
      ) =>
        state.hiddenMessageIdsByKey[
          resolveStreamKeyFromState(state, streamKey)
        ] ?? [];
      const getUserMessagesForKey = (
        state: MessagingStore,
        streamKey: string,
      ) =>
        state.userMessagesByKey[resolveStreamKeyFromState(state, streamKey)] ??
        EMPTY_MESSAGES;
      const getKeptAnswersForKey = (
        state: MessagingStore,
        streamKey: string,
      ): Record<string, KeptAnswer> =>
        state.keptAnswersByKey[resolveStreamKeyFromState(state, streamKey)] ??
        NO_KEPT_ANSWERS;
      const longer = (
        kept: KeptAnswer | undefined,
        content: ContentPart[],
      ): kept is KeptAnswer =>
        !!kept && contentSize(kept.message.content) > contentSize(content);

      const buildRenderableMessages = (
        state: MessagingStore,
        streamKey: string,
        includeApiMessages = true,
      ): Record<string, Message> => {
        const currentStreaming = getStreamingForKey(state, streamKey);
        const localUserMessages = Object.values(
          getUserMessagesForKey(state, streamKey),
        );
        const hiddenMessageIds = new Set(
          getHiddenMessageIdsForKey(state, streamKey),
        );
        const apiMessages = includeApiMessages
          ? Object.values(getApiMessagesForKey(state, streamKey)).filter(
              (message) => !hiddenMessageIds.has(message.id),
            )
          : [];
        const combinedMessages = mergeDisplayMessages(
          apiMessages,
          localUserMessages,
        );
        const keptAnswers = getKeptAnswersForKey(state, streamKey);
        let shownMessages = combinedMessages;
        Object.entries(keptAnswers).forEach(([id, kept]) => {
          const shown = combinedMessages[id] as Message | undefined;
          if (!shown || !longer(kept, shown.content)) return;
          if (shownMessages === combinedMessages)
            shownMessages = { ...combinedMessages };
          shownMessages[id] = { ...shown, content: kept.message.content };
        });

        if (!currentStreaming.currentMessageId) {
          return shownMessages;
        }

        // A turn that streams into an already-persisted message (a resumed
        // tool approval) has a stale copy of it in the API set from the
        // moment it starts. That copy wins only once finalization is over —
        // the completion refetch then holds the finished row — and not in
        // the window between the completion event and that refetch, where it
        // would show the message as it was before the turn.
        if (
          combinedMessages[currentStreaming.currentMessageId] &&
          !currentStreaming.isStreaming &&
          !currentStreaming.isFinalizing
        ) {
          return shownMessages;
        }

        const kept = keptAnswers[currentStreaming.currentMessageId];
        return {
          ...shownMessages,
          [currentStreaming.currentMessageId]: {
            id: currentStreaming.currentMessageId,
            content: longer(kept, currentStreaming.content)
              ? kept.message.content
              : currentStreaming.content,
            submission_outcome: currentStreaming.submissionOutcome,
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
        keptAnswersByKey: {},
        hiddenMessageIdsByKey: {},
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
        // Once navigation has consumed a new chat's id, the temporary key
        // must be available for another chat. Keep the real chat's buffers
        // and connection so its generation can continue in the background.
        releaseNewChatStream: () =>
          set(
            (prev) => {
              const streamKeyAliases = { ...prev.streamKeyAliases };
              delete streamKeyAliases[NEW_CHAT_STREAM_KEY];
              const isActive = prev.activeStreamKey === NEW_CHAT_STREAM_KEY;
              return {
                streamKeyAliases,
                newlyCreatedChatId: null,
                isAwaitingFirstStreamChunkForNewChat: false,
                ...(isActive
                  ? {
                      streaming: initialStreamingState,
                      userMessages: EMPTY_MESSAGES,
                      sseAbortCallback: null,
                    }
                  : {}),
              };
            },
            false,
            "messaging/releaseNewChatStream",
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
              const nextHiddenMessageIdsByKey = {
                ...prev.hiddenMessageIdsByKey,
              };
              const fromHiddenMessageIds = nextHiddenMessageIdsByKey[fromKey];
              if (fromHiddenMessageIds) {
                nextHiddenMessageIdsByKey[toKey] = fromHiddenMessageIds;
                delete nextHiddenMessageIdsByKey[fromKey];
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
                hiddenMessageIdsByKey: nextHiddenMessageIdsByKey,
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
        keepStreamedAnswer: (streamKey, { saved }) => {
          set(
            (prev) => {
              const resolvedKey = resolveStreamKeyFromState(
                prev,
                resolveStreamKey(streamKey),
              );
              const streaming = getStreamingForKey(prev, resolvedKey);
              const id = streaming.currentMessageId;
              const keptForKey = prev.keptAnswersByKey[resolvedKey] ?? {};
              const earlier = id ? keptForKey[id] : undefined;
              if (
                !id ||
                (contentSize(streaming.content) <=
                  contentSize(earlier?.message.content ?? []) &&
                  (!saved || earlier?.savedAt != null))
              ) {
                return prev;
              }
              return {
                ...prev,
                keptAnswersByKey: {
                  ...prev.keptAnswersByKey,
                  [resolvedKey]: {
                    ...keptForKey,
                    [id]: {
                      message: longer(earlier, streaming.content)
                        ? earlier.message
                        : {
                            id,
                            content: streaming.content,
                            submission_outcome: streaming.submissionOutcome,
                            role: "assistant",
                            createdAt:
                              streaming.createdAt ?? new Date().toISOString(),
                            status: "complete",
                          },
                      savedAt: earlier?.savedAt ?? (saved ? Date.now() : null),
                    },
                  },
                },
              };
            },
            false,
            "messaging/keepStreamedAnswer",
          );
        },
        markAnswersSaved: (streamKey, messageIds) => {
          set(
            (prev) => {
              const resolvedKey = resolveStreamKeyFromState(
                prev,
                resolveStreamKey(streamKey),
              );
              const keptForKey = prev.keptAnswersByKey[resolvedKey];
              const ids = Object.keys(keptForKey ?? {}).filter(
                (id) =>
                  keptForKey[id].savedAt === null &&
                  (!messageIds || messageIds.includes(id)),
              );
              if (ids.length === 0) return prev;
              const next = { ...keptForKey };
              const savedAt = Date.now();
              ids.forEach((id) => {
                next[id] = { ...next[id], savedAt };
              });
              return {
                ...prev,
                keptAnswersByKey: {
                  ...prev.keptAnswersByKey,
                  [resolvedKey]: next,
                },
              };
            },
            false,
            "messaging/markAnswersSaved",
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
        getHiddenMessageIds: (streamKey) => {
          const state = get();
          return getHiddenMessageIdsForKey(state, resolveStreamKey(streamKey));
        },
        setApiMessages: (messages, streamKey, requestedAt) =>
          set(
            (prev) => {
              const inputKey = resolveStreamKey(streamKey);
              const resolvedKey = resolveStreamKeyFromState(prev, inputKey);
              const nextById: Record<string, Message> = {};
              messages.forEach((message) => {
                nextById[message.id] = message;
              });
              // A copy at least as long replaces the stand-in, and once the
              // answer is saved, any copy fetched after that.
              const stillKept = Object.fromEntries(
                Object.entries(prev.keptAnswersByKey[resolvedKey] ?? {}).filter(
                  ([id, kept]) =>
                    !(
                      (id in nextById && !longer(kept, nextById[id].content)) ||
                      (kept.savedAt !== null &&
                        requestedAt !== undefined &&
                        requestedAt >= kept.savedAt)
                    ),
                ),
              );

              return {
                ...prev,
                apiMessagesByKey: {
                  ...prev.apiMessagesByKey,
                  [resolvedKey]: nextById,
                },
                keptAnswersByKey: {
                  ...prev.keptAnswersByKey,
                  [resolvedKey]: stillKept,
                },
              };
            },
            false,
            "messaging/setApiMessages",
          ),
        hideMessageIds: (messageIds, streamKey) =>
          set(
            (prev) => {
              const inputKey = resolveStreamKey(streamKey);
              const resolvedKey = resolveStreamKeyFromState(prev, inputKey);
              const previousHiddenMessageIds =
                prev.hiddenMessageIdsByKey[resolvedKey] ?? [];
              const addedMessageIds = messageIds.filter(
                (messageId) => !previousHiddenMessageIds.includes(messageId),
              );
              if (addedMessageIds.length === 0) {
                return prev;
              }
              // A superseded answer is not kept either.
              const keptForKey = { ...prev.keptAnswersByKey[resolvedKey] };
              addedMessageIds.forEach((messageId) => {
                delete keptForKey[messageId];
              });

              return {
                ...prev,
                keptAnswersByKey: {
                  ...prev.keptAnswersByKey,
                  [resolvedKey]: keptForKey,
                },
                hiddenMessageIdsByKey: {
                  ...prev.hiddenMessageIdsByKey,
                  [resolvedKey]: [
                    ...previousHiddenMessageIds,
                    ...addedMessageIds,
                  ],
                },
              };
            },
            false,
            "messaging/hideMessageIds",
          ),
        clearHiddenMessageIds: (streamKey) =>
          set(
            (prev) => {
              const inputKey = resolveStreamKey(streamKey);
              const resolvedKey = resolveStreamKeyFromState(prev, inputKey);
              if (!prev.hiddenMessageIdsByKey[resolvedKey]) {
                return prev;
              }

              const nextHiddenMessageIdsByKey = {
                ...prev.hiddenMessageIdsByKey,
              };
              delete nextHiddenMessageIdsByKey[resolvedKey];

              return {
                ...prev,
                hiddenMessageIdsByKey: nextHiddenMessageIdsByKey,
              };
            },
            false,
            "messaging/clearHiddenMessageIds",
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
            (prev) => ({ ...prev, apiMessagesByKey: {}, keptAnswersByKey: {} }),
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
        removeUserMessages: (messageIds, streamKey) =>
          set(
            (prev) => {
              const inputKey = resolveStreamKey(streamKey);
              const resolvedKey = resolveStreamKeyFromState(prev, inputKey);
              const previousUserMessages =
                prev.userMessagesByKey[resolvedKey] ?? EMPTY_MESSAGES;
              const removableIds = messageIds.filter(
                (messageId) => messageId in previousUserMessages,
              );
              if (removableIds.length === 0) {
                return prev;
              }

              const nextUserMessages = { ...previousUserMessages };
              for (const messageId of removableIds) {
                delete nextUserMessages[messageId];
              }

              const activeResolvedKey = resolveStreamKeyFromState(
                prev,
                prev.activeStreamKey,
              );
              return {
                ...prev,
                userMessagesByKey: {
                  ...prev.userMessagesByKey,
                  [resolvedKey]: nextUserMessages,
                },
                userMessages:
                  activeResolvedKey === resolvedKey
                    ? nextUserMessages
                    : prev.userMessages,
              };
            },
            false,
            "messaging/removeUserMessages",
          ),
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
      // The extension filters before serializing, so a streamed token no
      // longer copies the whole store, every chat's messages included.
      actionsDenylist: [
        "messaging/handleTextDelta",
        "messaging/handleReasoningDelta",
      ],
    },
  ),
);

// A reload for a newer build would cut off an answer streaming in.
registerWorkInProgress(() =>
  Object.values(useMessagingStore.getState().streamingByKey).some(
    (streaming) => streaming.isStreaming,
  ),
);
