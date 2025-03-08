import { skipToken, useInfiniteQuery } from "@tanstack/react-query";
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
import { useChatMessages } from "../../lib/generated/v1betaApi/v1betaApiComponents";

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
const MESSAGE_PAGE_SIZE = 6;
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
  const { currentStreamingMessage, streamMessage } = useMessageStream();

  // Local storage cache for chat sessions
  const [chatCache, setChatCache] = useLocalStorage<{
    [sessionId: string]: {
      messages: MessageMap;
      messageOrder: string[];
      lastUpdated: number;
    };
  }>(LOCAL_STORAGE_KEY, {});

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
    messageOffset,
  } = chatState;

  // Log state values when in debug mode
  useEffect(() => {
    throttledLog("Chat state updated:", {
      messagesCount: Object.keys(messages).length,
      messageOrderLength: messageOrder.length,
      hasOlderMessages,
      lastLoadedCount,
      apiMessagesResponse,
      messageOffset,
      isLoading,
    });
  }, [
    messages,
    messageOrder,
    hasOlderMessages,
    lastLoadedCount,
    apiMessagesResponse,
    messageOffset,
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

  // Handle session ID changes
  useUpdateEffect(() => {
    // Skip effect for null session ID
    if (!currentSessionId) return;

    try {
      throttledLog(`Resetting state for session: ${currentSessionId}`);

      // Reset state for new session
      dispatch({ type: "RESET_STATE", sessionId: currentSessionId });

      // For temporary sessions, ensure messages are cleared
      if (currentSessionId.startsWith("temp-")) {
        dispatch({
          type: "SET_MESSAGES",
          messages: {},
          messageOrder: [],
        });
      }
    } catch (error) {
      throttledLog("Error handling session change:", error);
    }
  }, [currentSessionId]);

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

  // Track previous API response to prevent processing the same data multiple times
  const prevApiResponseRef = useRef<string | null>(null);

  // Helper to identify API responses
  const getResponseIdentifier = useCallback(
    (apiResponse: ChatMessagesResponse, offset: number): string => {
      // Check for empty messages array
      if (apiResponse.messages.length === 0) return "";

      const firstId = apiResponse.messages[0]?.id;
      const lastId = apiResponse.messages[apiResponse.messages.length - 1]?.id;
      return `${firstId}-${lastId}-${apiResponse.messages.length}-${offset}`;
    },
    [],
  );

  // Helper to update pagination state
  const updatePaginationState = useCallback(
    (apiResponse: ChatMessagesResponse) => {
      dispatch({
        type: "SET_HAS_OLDER_MESSAGES",
        hasOlderMessages: apiResponse.stats.has_more,
      });
      dispatch({
        type: "SET_LAST_LOADED_COUNT",
        count: apiResponse.messages.length,
      });
    },
    [],
  );

  // Helper to process initial messages (offset 0)
  const processInitialMessages = useCallback(
    (apiResponse: ChatMessagesResponse) => {
      // Initial load: Replace all messages
      const newMessages: MessageMap = {};
      const newOrder: string[] = [];

      // API returns messages in newest-first order, but we want oldest-first in our UI
      // So we process them in reverse to get chronological order
      for (let i = apiResponse.messages.length - 1; i >= 0; i--) {
        const message = convertApiMessageToAppMessage(apiResponse.messages[i]);
        newMessages[message.id] = message;
        newOrder.push(message.id);
      }

      throttledLog(`Setting initial messages: ${newOrder.length} messages`);

      dispatch({
        type: "SET_MESSAGES",
        messages: newMessages,
        messageOrder: newOrder,
      });
    },
    [convertApiMessageToAppMessage],
  );

  // Helper to process older messages (offset > 0)
  const processOlderMessages = useCallback(
    (apiResponse: ChatMessagesResponse) => {
      // Loading older messages with an offset > 0
      const newMessages: MessageMap = {};
      const newMessageIds: string[] = [];

      // API returns messages in NEWEST-FIRST order (for any offset)
      // Process in REVERSE to get OLDEST-FIRST order
      for (let i = apiResponse.messages.length - 1; i >= 0; i--) {
        const apiMessage = apiResponse.messages[i];
        const message = convertApiMessageToAppMessage(apiMessage);

        // Only add if not already in the list
        if (!(message.id in messages)) {
          newMessages[message.id] = message;
          newMessageIds.push(message.id); // Add in OLDEST-FIRST order
        }
      }

      throttledLog(`Found ${newMessageIds.length} new messages to add`);
      throttledLog(`Current message order: ${messageOrder.length} messages`);

      // The newMessageIds are already in oldest-first order
      if (newMessageIds.length > 0) {
        throttledLog(`Prepending ${newMessageIds.length} older messages`);

        // Prepend the new (older) messages to the existing message order
        dispatch({
          type: "PREPEND_MESSAGES",
          messages: newMessages,
          messageIds: newMessageIds,
        });
      } else {
        throttledLog("No new messages to add after filtering");
      }
    },
    [messages, messageOrder, convertApiMessageToAppMessage],
  );

  // Process messages from the API
  const processApiMessages = useCallback(
    (apiResponse: ChatMessagesResponse) => {
      if (apiResponse.messages.length === 0) {
        throttledLog("No messages in API response, skipping processing");
        return;
      }

      throttledLog(
        `Processing API response: offset=${messageOffset}, messages count=${apiResponse.messages.length}, has_more=${apiResponse.stats.has_more}`,
      );
      throttledLog(
        `First message ID: ${apiResponse.messages[0]?.id}, Last message ID: ${apiResponse.messages[apiResponse.messages.length - 1]?.id}`,
      );

      // Generate a response identifier and check for duplicates
      const responseId = getResponseIdentifier(apiResponse, messageOffset);
      if (prevApiResponseRef.current === responseId) {
        throttledLog(`Skipping duplicate response: ${responseId}`);
        return;
      }

      // Update our reference for next time
      prevApiResponseRef.current = responseId;

      // Update pagination state
      updatePaginationState(apiResponse);

      // Process messages based on offset
      if (messageOffset === 0) {
        processInitialMessages(apiResponse);
      } else {
        processOlderMessages(apiResponse);
      }
    },
    [
      messageOffset,
      getResponseIdentifier,
      updatePaginationState,
      processInitialMessages,
      processOlderMessages,
    ],
  );

  // Use React Query for message fetching with proper cancellation
  const { data: freshApiMessagesResponse, isLoading: apiLoadingState } =
    useChatMessages(
      currentSessionId && !currentSessionId.startsWith("temp-")
        ? {
            pathParams: { chatId: currentSessionId },
            queryParams: {
              limit: MESSAGE_PAGE_SIZE,
              offset: messageOffset,
            },
          }
        : skipToken,
      {
        enabled: !!currentSessionId && !currentSessionId.startsWith("temp-"),
        staleTime: 30000,
        // Using options compatible with React Query v5
        gcTime: 5000, // Short garbage collection time
      },
    );

  // Handle successful API responses only when response changes
  useUpdateEffect(() => {
    if (freshApiMessagesResponse) {
      // Update API response reference
      dispatch({
        type: "SET_API_RESPONSE",
        response: freshApiMessagesResponse,
      });

      // Process the messages
      processApiMessages(freshApiMessagesResponse);
    }
  }, [freshApiMessagesResponse]);

  // Update loading state based on API
  useUpdateEffect(() => {
    dispatch({ type: "SET_LOADING", isLoading: apiLoadingState });
  }, [apiLoadingState]);

  // Simplified useInfiniteQuery demonstration that maintains button-based loading

  const {
    fetchNextPage,
    hasNextPage, // This variable is now allowed to be unused
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["chatMessages", currentSessionId],
    queryFn: async ({ pageParam: _pageParam = 0 }) => {
      // In a real implementation, you'd fetch data here
      // For now, we're simulating by just returning the messages
      // This is simulated - in a real implementation,
      // this would be a proper API call like fetchChatMessages
      return (
        freshApiMessagesResponse ?? {
          messages: [],
          stats: {
            has_more: false,
            total_count: 0,
            returned_count: 0,
            current_offset: 0,
          },
        }
      );
    },
    initialPageParam: 0,
    getNextPageParam: (_lastPage, _allPages, lastPageParam) => {
      // For demonstration - real implementation would check lastPage.stats.has_more
      return hasOlderMessages ? lastPageParam + MESSAGE_PAGE_SIZE : undefined;
    },
    enabled: false, // Disable auto-fetching - only trigger via button
  });

  // Logger for the infinite query state
  useEffect(() => {
    throttledLog("Infinite query state:", {
      hasNextPage,
      isFetchingNextPage,
    });
  }, [hasNextPage, isFetchingNextPage]);

  // Function to load older messages - using React Query's fetchNextPage
  // This maintains the button-based loading approach
  const loadOlderMessages = useCallback(() => {
    if (hasOlderMessages && !isLoading) {
      throttledLog(`Loading older messages: using React Query's fetchNextPage`);

      // Set loading state manually to reflect in the UI immediately
      dispatch({ type: "SET_LOADING", isLoading: true });

      // Use the standard messageOffset increment to maintain compatibility
      dispatch({ type: "INCREMENT_MESSAGE_OFFSET" });

      // This is the key improvement - you could eventually migrate all
      // loading logic to use fetchNextPage instead of messageOffset
      // But for now, both mechanisms work together
      void fetchNextPage();
    } else if (isLoading) {
      throttledLog("Skipping loadOlderMessages because already loading");
    } else {
      throttledLog("No more older messages to load");
    }
  }, [hasOlderMessages, isLoading, fetchNextPage]);

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
      }

      throttledUpdate.current = null;
    }, 16); // Using ~60fps (16ms) for near-instant visual updates

    // Clean up on unmount
    return () => {
      if (throttledUpdate.current) {
        clearTimeout(throttledUpdate.current);
      }
    };
  }, [
    currentStreamingMessage,
    currentSessionId,
    messages,
    messageOrder,
    updateMessage,
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

  // Get the latest stats from the API response
  const latestApiStats = useMemo(() => {
    if (!freshApiMessagesResponse) {
      return null;
    }

    // Return stats from the most recent page
    return freshApiMessagesResponse.stats;
  }, [freshApiMessagesResponse]);

  // Memoize the context value for performance
  const contextValue = useMemo(
    () => ({
      messages,
      messageOrder,
      sendMessage,
      updateMessage,
      loadOlderMessages,
      hasOlderMessages,
      isLoading: isLoading || isFetchingNextPage, // Include both loading states
      lastLoadedCount: latestApiStats?.returned_count ?? 0,
      apiMessagesResponse,
    }),
    [
      messages,
      messageOrder,
      sendMessage,
      updateMessage,
      loadOlderMessages,
      hasOlderMessages,
      isLoading,
      isFetchingNextPage,
      latestApiStats,
      apiMessagesResponse,
    ],
  );

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
