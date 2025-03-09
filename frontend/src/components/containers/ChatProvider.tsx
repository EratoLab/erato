import * as reactQuery from "@tanstack/react-query";
import React, {
  createContext,
  useContext,
  useCallback,
  useMemo,
  useReducer,
  useRef,
  useEffect,
} from "react";
import { useUpdateEffect, useLocalStorage } from "react-use";

import { useChatHistory } from "./ChatHistoryProvider";
import { useMessageStream } from "./MessageStreamProvider";

import type {
  ChatMessage as APIChatMessage,
  ChatMessagesResponse,
} from "../../lib/generated/v1betaApi/v1betaApiSchemas";
import type { StreamingContext } from "@/types/chat";

/**
 * ChatMessage represents a single chat message.
 */
export interface ChatMessage {
  id: string;
  content: string;
  sender: "user" | "assistant";
  createdAt: Date;
  authorId: string;
  loading?: StreamingContext;
  error?: Error;
}

// Mapping of message IDs to message objects
interface MessageMap {
  [messageId: string]: ChatMessage;
}

/**
 * ChatContextType describes the shape of the chat state and actions.
 */
export interface ChatContextType {
  messages: MessageMap;
  messageOrder: string[]; // Preserve message order
  sendMessage: (message: string) => Promise<void>;
  updateMessage: (messageId: string, updates: Partial<ChatMessage>) => void;
  loadOlderMessages: () => void;
  hasOlderMessages: boolean;
  isLoading: boolean;
  lastLoadedCount: number; // Number of messages loaded in the last batch
  apiMessagesResponse?: ChatMessagesResponse; // Raw API response data with stats
}

// Action types for the chat reducer
type ChatAction =
  | { type: "RESET_STATE"; sessionId: string | null }
  | { type: "SET_LOADING"; isLoading: boolean }
  | { type: "SET_MESSAGES"; messages: MessageMap; messageOrder: string[] }
  | { type: "PREPEND_MESSAGES"; messages: MessageMap; messageIds: string[] }
  | { type: "ADD_MESSAGE"; message: ChatMessage }
  | { type: "UPDATE_MESSAGE"; messageId: string; updates: Partial<ChatMessage> }
  | { type: "SET_HAS_OLDER_MESSAGES"; hasOlderMessages: boolean }
  | { type: "SET_LAST_LOADED_COUNT"; count: number }
  | { type: "SET_API_RESPONSE"; response: ChatMessagesResponse | undefined }
  | { type: "INCREMENT_MESSAGE_OFFSET" }
  | { type: "RESET_MESSAGE_OFFSET" };

// State type for the chat reducer
interface ChatState {
  messages: MessageMap;
  messageOrder: string[];
  isLoading: boolean;
  hasOlderMessages: boolean;
  lastLoadedCount: number;
  apiMessagesResponse?: ChatMessagesResponse;
  messageOffset: number;
}

// Initial state for the chat reducer
const initialChatState: ChatState = {
  messages: {},
  messageOrder: [],
  isLoading: false,
  hasOlderMessages: false,
  lastLoadedCount: 0,
  messageOffset: 0,
};

// Constants for the component
const MESSAGE_PAGE_SIZE = 20; // Number of messages to fetch per page
const DEBUG = process.env.NODE_ENV === "development";
const log = (...args: unknown[]) => DEBUG && console.log(...args);
const LOCAL_STORAGE_KEY = "chat_cache_v1";

// Throttle log messages to prevent spam
const logTimestamps = new Map<string, number>();
const throttledLog = (message: string, ...args: unknown[]) => {
  const now = Date.now();
  const lastLog = logTimestamps.get(message) ?? 0;
  if (now - lastLog > 5000) {
    // Only log the same message once every 5 seconds
    log(message, ...args);
    logTimestamps.set(message, now);
  }
};

// Reducer function to handle all chat state updates
const chatReducer = (state: ChatState, action: ChatAction): ChatState => {
  switch (action.type) {
    case "RESET_STATE":
      // Reset state when changing chats
      return {
        ...initialChatState,
        // Keep API response reference if same session
        apiMessagesResponse:
          action.sessionId === null ? undefined : state.apiMessagesResponse,
      };

    case "SET_LOADING":
      return { ...state, isLoading: action.isLoading };

    case "SET_MESSAGES":
      return {
        ...state,
        messages: action.messages,
        messageOrder: action.messageOrder,
      };

    case "PREPEND_MESSAGES":
      return {
        ...state,
        messages: { ...action.messages, ...state.messages },
        messageOrder: [...action.messageIds, ...state.messageOrder],
      };

    case "ADD_MESSAGE":
      return {
        ...state,
        messages: { ...state.messages, [action.message.id]: action.message },
        messageOrder: [...state.messageOrder, action.message.id],
      };

    case "UPDATE_MESSAGE":
      return {
        ...state,
        messages: {
          ...state.messages,
          [action.messageId]: {
            ...state.messages[action.messageId],
            ...action.updates,
          },
        },
      };

    case "SET_HAS_OLDER_MESSAGES":
      return { ...state, hasOlderMessages: action.hasOlderMessages };

    case "SET_LAST_LOADED_COUNT":
      return { ...state, lastLoadedCount: action.count };

    case "SET_API_RESPONSE":
      return { ...state, apiMessagesResponse: action.response };

    case "INCREMENT_MESSAGE_OFFSET":
      return {
        ...state,
        messageOffset: state.messageOffset + MESSAGE_PAGE_SIZE,
      };

    case "RESET_MESSAGE_OFFSET":
      return { ...state, messageOffset: 0 };

    default:
      return state;
  }
};

const ChatContext = createContext<ChatContextType | undefined>(undefined);

interface ChatProviderProps extends React.PropsWithChildren {
  // For storybook/testing only
  initialMessages?: MessageMap;
  initialMessageOrder?: string[];
}

/**
 * ChatProvider is responsible for managing and providing chat state logic.
 */
export const ChatProvider: React.FC<ChatProviderProps> = ({
  children,
  initialMessages = {},
  initialMessageOrder = [],
}) => {
  const { currentSessionId } = useChatHistory();
  const { currentStreamingMessage, streamMessage, resetStreaming } =
    useMessageStream();

  // Local storage cache for chat sessions
  const [chatCache, setChatCache] = useLocalStorage<{
    [sessionId: string]: {
      messages: MessageMap;
      messageOrder: string[];
      lastUpdated: number;
    };
  }>(LOCAL_STORAGE_KEY, {});

  // Store React Query client for cache invalidation
  const queryClient = reactQuery.useQueryClient();

  // Initialize with cached data if available
  const getCachedInitialState = useCallback(() => {
    if (!currentSessionId || !chatCache?.[currentSessionId]) {
      return {
        ...initialChatState,
        messages: initialMessages,
        messageOrder: initialMessageOrder,
      };
    }

    // Use cached data if it exists and isn't too old (24 hours)
    const cached = chatCache[currentSessionId];
    const now = Date.now();
    const isCacheValid = now - cached.lastUpdated < 24 * 60 * 60 * 1000;

    if (isCacheValid) {
      throttledLog(`Using cached data for session ${currentSessionId}`);
      return {
        ...initialChatState,
        messages: cached.messages,
        messageOrder: cached.messageOrder,
      };
    } else {
      throttledLog(`Cache expired for session ${currentSessionId}`);
      return {
        ...initialChatState,
        messages: initialMessages,
        messageOrder: initialMessageOrder,
      };
    }
  }, [currentSessionId, chatCache, initialMessages, initialMessageOrder]);

  // Use a reducer for complex state management
  const [chatState, dispatch] = useReducer(
    chatReducer,
    getCachedInitialState(),
  );

  const {
    messages,
    messageOrder,
    isLoading,
    hasOlderMessages,
    lastLoadedCount,
    apiMessagesResponse,
  } = chatState;

  // Log state values when in debug mode
  useEffect(() => {
    throttledLog("Chat state updated:", {
      messagesCount: Object.keys(messages).length,
      messageOrderLength: messageOrder.length,
      hasOlderMessages,
      lastLoadedCount,
      apiMessagesResponse,
      isLoading,
    });
  }, [
    messages,
    messageOrder,
    hasOlderMessages,
    lastLoadedCount,
    apiMessagesResponse,
    isLoading,
  ]);

  // Update cache when chat state changes
  useUpdateEffect(() => {
    if (!currentSessionId) return;

    // Don't cache temporary sessions
    if (currentSessionId.startsWith("temp-")) return;

    // Only cache if we have messages
    if (Object.keys(messages).length === 0) return;

    setChatCache((prev) => ({
      ...prev,
      [currentSessionId]: {
        messages,
        messageOrder,
        lastUpdated: Date.now(),
      },
    }));

    throttledLog(
      `Updated cache for session ${currentSessionId} with ${messageOrder.length} messages`,
    );
  }, [currentSessionId, messages, messageOrder]);

  // Convert API messages to the app's message format
  const convertApiMessageToAppMessage = useCallback(
    (apiMessage: APIChatMessage): ChatMessage => {
      return {
        id: apiMessage.id,
        content: apiMessage.full_text,
        sender: apiMessage.role === "assistant" ? "assistant" : "user",
        createdAt: new Date(apiMessage.created_at),
        authorId: apiMessage.role,
      };
    },
    [],
  );

  // Enhanced infinite query for messages using React Query's useInfiniteQuery
  const {
    data: paginatedMessages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: isLoadingInfiniteMessages,
    refetch: refetchMessages,
  } = reactQuery.useInfiniteQuery({
    queryKey: ["chatMessages", currentSessionId],
    queryFn: async ({ pageParam = 0 }) => {
      if (!currentSessionId || currentSessionId.startsWith("temp-")) {
        // Return empty response for temporary sessions
        return {
          messages: [],
          stats: {
            has_more: false,
            total_count: 0,
            returned_count: 0,
            current_offset: 0,
          },
        } as ChatMessagesResponse;
      }

      // Fetch messages from the API
      const response = await fetch(
        `/api/v1beta/chats/${currentSessionId}/messages?limit=${MESSAGE_PAGE_SIZE}&offset=${pageParam}`,
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch messages: ${response.status}`);
      }

      return (await response.json()) as ChatMessagesResponse;
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      // If has_more is true, return the next offset for pagination
      if (lastPage.stats.has_more) {
        return lastPage.stats.current_offset + lastPage.stats.returned_count;
      }
      // Return undefined to signal we've reached the end
      return undefined;
    },
    enabled: !!currentSessionId && !currentSessionId.startsWith("temp-"),
    staleTime: 30000, // 30 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
  });

  // Process messages from the paginated data
  useEffect(() => {
    if (!paginatedMessages || !currentSessionId) return;

    // Handle all pages in one batch to avoid UI flicker
    const newMessages: MessageMap = {};
    const newMessageIds: string[] = [];

    // First, clear the current messages if this is a new session
    if (Object.keys(messages).length === 0) {
      log("Processing all pages of messages for initial load");

      // Process all pages of messages
      paginatedMessages.pages.forEach((page) => {
        if (!page.messages.length) return;

        // Messages come in descending order (newest first), but we want ascending
        // Start from the last page and process in reverse order
        const pageMessages = [...page.messages].reverse();

        pageMessages.forEach((apiMessage) => {
          const message = convertApiMessageToAppMessage(apiMessage);
          if (!(message.id in newMessages)) {
            newMessages[message.id] = message;
            newMessageIds.push(message.id);
          }
        });
      });

      if (newMessageIds.length > 0) {
        dispatch({
          type: "SET_MESSAGES",
          messages: newMessages,
          messageOrder: newMessageIds,
        });
      }

      // Update pagination state based on the most recent page
      const latestPage =
        paginatedMessages.pages[paginatedMessages.pages.length - 1];
      dispatch({
        type: "SET_HAS_OLDER_MESSAGES",
        hasOlderMessages: latestPage.stats.has_more,
      });

      dispatch({
        type: "SET_LAST_LOADED_COUNT",
        count: latestPage.messages.length,
      });

      dispatch({
        type: "SET_API_RESPONSE",
        response: latestPage,
      });
    }
    // If we already have messages and are loading more, only process new pages
    else if (paginatedMessages.pages.length > 1) {
      log("Processing new pages for pagination");

      // Get the latest page (the one just loaded)
      const latestPage =
        paginatedMessages.pages[paginatedMessages.pages.length - 1];

      // Process messages in reverse order to get oldest first
      const pageMessages = [...latestPage.messages].reverse();

      pageMessages.forEach((apiMessage) => {
        const message = convertApiMessageToAppMessage(apiMessage);
        if (!(message.id in messages) && !(message.id in newMessages)) {
          newMessages[message.id] = message;
          newMessageIds.push(message.id);
        }
      });

      if (newMessageIds.length > 0) {
        log(`Adding ${newMessageIds.length} older messages`);

        // Prepend older messages
        dispatch({
          type: "PREPEND_MESSAGES",
          messages: newMessages,
          messageIds: newMessageIds,
        });
      }

      // Update pagination state
      dispatch({
        type: "SET_HAS_OLDER_MESSAGES",
        hasOlderMessages: latestPage.stats.has_more,
      });

      dispatch({
        type: "SET_LAST_LOADED_COUNT",
        count: latestPage.messages.length,
      });

      dispatch({
        type: "SET_API_RESPONSE",
        response: latestPage,
      });
    }
  }, [
    paginatedMessages,
    currentSessionId,
    messages,
    convertApiMessageToAppMessage,
  ]);

  // Update loading state
  useEffect(() => {
    dispatch({
      type: "SET_LOADING",
      isLoading: isLoadingInfiniteMessages || isFetchingNextPage,
    });
  }, [isLoadingInfiniteMessages, isFetchingNextPage]);

  // Function to load older messages - using React Query's fetchNextPage
  const loadOlderMessages = useCallback(() => {
    if (!hasNextPage || isLoading) {
      log(
        hasNextPage ? "Already loading messages" : "No more messages to load",
      );
      return;
    }

    log("Loading older messages with fetchNextPage");

    // Set loading state first for better UI feedback
    dispatch({ type: "SET_LOADING", isLoading: true });

    // Use fetchNextPage from useInfiniteQuery to load the next page of messages
    void fetchNextPage();
  }, [hasNextPage, isLoading, fetchNextPage]);

  // Helper to generate unique IDs
  const generateMessageId = useCallback(() => crypto.randomUUID(), []);

  // Helper to add messages to local state
  const addMessage = useCallback((message: ChatMessage) => {
    dispatch({ type: "ADD_MESSAGE", message });
  }, []);

  // Helper to update messages in local state
  const updateMessage = useCallback(
    (messageId: string, updates: Partial<ChatMessage>) => {
      dispatch({ type: "UPDATE_MESSAGE", messageId, updates });
    },
    [],
  );

  // Throttle updates to reduce unnecessary renders
  const throttledUpdate = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Process streaming updates
  useUpdateEffect(() => {
    if (!currentStreamingMessage || !currentSessionId) return;

    // Find the last assistant message to update
    const assistantMessages = messageOrder
      .map((id) => messages[id])
      .filter((msg) => msg.sender === "assistant");

    // Skip update if no assistant messages exist
    if (assistantMessages.length === 0) {
      return;
    }

    const lastAssistantMessage =
      assistantMessages[assistantMessages.length - 1];
    const messageId = lastAssistantMessage.id;

    // Cancel previous update if it exists
    if (throttledUpdate.current) {
      clearTimeout(throttledUpdate.current);
    }

    throttledUpdate.current = setTimeout(() => {
      const currentContent = messages[messageId].content;
      const newContent = currentStreamingMessage.content;

      // Only update if content or status changed
      if (
        currentContent !== newContent ||
        !!messages[messageId].loading !== !currentStreamingMessage.isComplete ||
        !!messages[messageId].error !== !!currentStreamingMessage.error
      ) {
        updateMessage(messageId, {
          content: newContent,
          loading: currentStreamingMessage.isComplete
            ? undefined
            : { state: "loading" },
          error:
            currentStreamingMessage.error instanceof Error
              ? currentStreamingMessage.error
              : undefined,
        });

        // If the message is complete, invalidate the chat messages query cache
        // This ensures that when we come back to this chat, we'll get fresh data
        if (
          currentStreamingMessage.isComplete &&
          !currentStreamingMessage.error
        ) {
          throttledLog(
            `Message complete, invalidating cache for chat ${currentSessionId}`,
          );
          // Invalidate the specific chat messages query
          void queryClient.invalidateQueries({
            queryKey: ["chatMessages", currentSessionId],
            exact: true,
          });
        }
      }

      throttledUpdate.current = null;
    }, 16); // Using ~60fps (16ms) for near-instant visual updates

    // Clean up on unmount
    return () => {
      if (throttledUpdate.current) {
        clearTimeout(throttledUpdate.current);
        throttledUpdate.current = null;
      }
    };
  }, [
    currentStreamingMessage,
    currentSessionId,
    messages,
    messageOrder,
    updateMessage,
    queryClient,
  ]);

  // Send a message and handle streaming
  const sendMessage = useCallback(
    async (content: string) => {
      if (!currentSessionId) return;

      dispatch({ type: "SET_LOADING", isLoading: true });

      try {
        // Get last message ID for context
        const recentMessages = messageOrder
          .map((id) => messages[id])
          .filter((msg) => msg.sender === "assistant");

        const lastMessageId =
          recentMessages.length > 0
            ? recentMessages[recentMessages.length - 1].id
            : undefined;

        // Add user message
        const userMessage: ChatMessage = {
          id: generateMessageId(),
          content,
          sender: "user",
          createdAt: new Date(),
          authorId: "user_1",
        };
        addMessage(userMessage);

        // Add assistant placeholder immediately so streaming can begin
        const assistantMessageId = generateMessageId();
        const assistantMessage: ChatMessage = {
          id: assistantMessageId,
          content: "", // Initial empty content that will be streamed
          sender: "assistant",
          createdAt: new Date(),
          loading: { state: "loading" },
          authorId: "assistant",
        };
        addMessage(assistantMessage);

        // This ensures the placeholder message is added before streaming starts
        // Ensures React can render it before content starts streaming
        await new Promise((resolve) => setTimeout(resolve, 0));

        // Start streaming the response
        await streamMessage(currentSessionId, content, lastMessageId);
      } catch (error) {
        throttledLog("Error sending message:", error);

        // Update last message with error
        const lastMessageId = messageOrder[messageOrder.length - 1];
        if (lastMessageId) {
          updateMessage(lastMessageId, {
            error:
              error instanceof Error
                ? error
                : new Error("Failed to send message"),
            loading: undefined,
          });
        }
      } finally {
        dispatch({ type: "SET_LOADING", isLoading: false });
      }
    },
    [
      currentSessionId,
      messageOrder,
      messages,
      addMessage,
      generateMessageId,
      streamMessage,
      updateMessage,
    ],
  );

  // Memoize the context value for performance
  const contextValue = useMemo<ChatContextType>(
    () => ({
      messages,
      messageOrder,
      sendMessage,
      updateMessage,
      loadOlderMessages,
      hasOlderMessages: hasNextPage === true,
      isLoading,
      lastLoadedCount,
      apiMessagesResponse,
    }),
    [
      messages,
      messageOrder,
      sendMessage,
      updateMessage,
      loadOlderMessages,
      hasNextPage,
      isLoading,
      lastLoadedCount,
      apiMessagesResponse,
    ],
  );

  // Handle session ID changes - reset state and refetch
  useUpdateEffect(() => {
    // Skip effect for null session ID
    if (!currentSessionId) return;

    try {
      throttledLog(`Resetting state for session: ${currentSessionId}`);

      // Reset streaming message state when changing chats
      resetStreaming();

      // Reset state for new session
      dispatch({ type: "RESET_STATE", sessionId: currentSessionId });

      // For temporary sessions, ensure messages are cleared
      if (currentSessionId.startsWith("temp-")) {
        dispatch({
          type: "SET_MESSAGES",
          messages: {},
          messageOrder: [],
        });
      } else {
        // Refetch messages for non-temporary sessions with no caching
        // Force refetch with fresh data by invalidating the cache first
        void queryClient.invalidateQueries({
          queryKey: ["chatMessages", currentSessionId],
          exact: true,
        });
        void refetchMessages();
      }
    } catch (error) {
      throttledLog("Error handling session change:", error);
    }
  }, [currentSessionId, refetchMessages, resetStreaming, queryClient]);

  return (
    <ChatContext.Provider value={contextValue}>{children}</ChatContext.Provider>
  );
};

export const useChat = (): ChatContextType => {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChat must be used within a ChatProvider");
  }
  return context;
};
