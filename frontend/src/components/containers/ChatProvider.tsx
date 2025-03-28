/**
 * ChatProvider Component
 *
 * Provides chat functionality and state management for the application.
 *
 * ** IMPORTANT IMPLEMENTATION NOTE **
 * There was a critical issue with message streaming where messages would disappear
 * after completion. This was fixed by:
 *
 * 1. Ensuring that message content and loading state are updated in a single operation
 * 2. Directly updating the React Query cache with the complete message state
 * 3. Removing asynchronous timeouts that created race conditions
 *
 * When working with streaming messages, always maintain this pattern to prevent regression!
 */

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
import { useUpdateEffect } from "react-use";

import { generateMessageId } from "@/hooks/useChatMessaging";
import { useFileUpload } from "@/hooks/useFileUpload";
import { convertApiMessageToAppMessage } from "@/hooks/useMessageProcessing";
import {
  useChatMessages,
  chatMessagesQuery,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { debugLog } from "@/utils/debugLogger";

import { useChatHistory } from "./ChatHistoryProvider";
import { useMessagingContext } from "./MessagingProvider";

import type {
  ChatMessagesResponse,
  FileUploadItem,
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
  attachments?: { id: string; filename: string }[]; // Added file attachments
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
  isPending: boolean;
  lastLoadedCount: number; // Number of messages loaded in the last batch
  apiMessagesResponse?: ChatMessagesResponse; // Raw API response data with stats
  handleFileAttachments: (files: { id: string; filename: string }[]) => void; // Added for file handling
  performFileUpload: (files: File[]) => Promise<FileUploadItem[] | undefined>; // Added for file uploading
  isUploadingFiles: boolean; // File upload status
  uploadError: Error | null; // File upload error state
}

// Action types for the chat reducer
type ChatAction =
  | { type: "RESET_STATE"; sessionId: string | null }
  | { type: "SET_LOADING"; isPending: boolean }
  | { type: "SET_MESSAGES"; messages: MessageMap; messageOrder: string[] }
  | { type: "PREPEND_MESSAGES"; messages: MessageMap; messageIds: string[] }
  | { type: "ADD_MESSAGE"; message: ChatMessage }
  | { type: "UPDATE_MESSAGE"; messageId: string; updates: Partial<ChatMessage> }
  | { type: "SET_LAST_LOADED_COUNT"; count: number }
  | { type: "SET_API_RESPONSE"; response: ChatMessagesResponse | undefined }
  | { type: "INCREMENT_MESSAGE_OFFSET" }
  | { type: "RESET_MESSAGE_OFFSET" };

// State type for the chat reducer
interface ChatState {
  messages: MessageMap;
  messageOrder: string[];
  isPending: boolean;
  lastLoadedCount: number;
  apiMessagesResponse?: ChatMessagesResponse;
}

// Initial state for the chat reducer
const initialChatState: ChatState = {
  messages: {},
  messageOrder: [],
  isPending: false,
  lastLoadedCount: 0,
};

// Constants for the component
const MESSAGE_PAGE_SIZE = 20; // Number of messages to fetch per page
const DEBUG = process.env.NODE_ENV === "development";
const log = (...args: unknown[]) => DEBUG && console.log(...args);

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

// Add toggle for verbose debugging
const ENABLE_VERBOSE_DEBUG = true; // Easy toggle to disable extra logs

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
      return { ...state, isPending: action.isPending };

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

    case "SET_LAST_LOADED_COUNT":
      return { ...state, lastLoadedCount: action.count };

    case "SET_API_RESPONSE":
      return { ...state, apiMessagesResponse: action.response };

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
  const {
    currentStreamingMessageId,
    messages: streamingMessages,
    streamingStatus,
    sendMessage: contextSendMessage,
  } = useMessagingContext();

  // Store React Query client for cache management
  const queryClient = reactQuery.useQueryClient();

  // Initialize with cached data if available
  const getCachedInitialState = () => {
    if (!currentSessionId) {
      return {
        ...initialChatState,
        messages: initialMessages,
        messageOrder: initialMessageOrder,
      };
    }

    // Try to get data from React Query cache
    const cachedData = queryClient.getQueryData<{
      messages: MessageMap;
      messageOrder: string[];
      lastUpdated: number;
    }>(["chatSession", currentSessionId]);

    if (!cachedData) {
      return {
        ...initialChatState,
        messages: initialMessages,
        messageOrder: initialMessageOrder,
      };
    }

    // Check if cache is still valid (24 hours)
    const now = Date.now();
    const isCacheValid = now - cachedData.lastUpdated < 24 * 60 * 60 * 1000;

    if (isCacheValid) {
      throttledLog(`Using cached data for session ${currentSessionId}`);
      return {
        ...initialChatState,
        messages: cachedData.messages,
        messageOrder: cachedData.messageOrder,
      };
    } else {
      throttledLog(`Cache expired for session ${currentSessionId}`);
      return {
        ...initialChatState,
        messages: initialMessages,
        messageOrder: initialMessageOrder,
      };
    }
  };

  // Use a reducer for complex state management
  const [chatState, dispatch] = useReducer(
    chatReducer,
    getCachedInitialState(),
  );

  // Wrap dispatch to log state changes
  const loggedDispatch = useCallback(
    (action: ChatAction) => {
      debugLog("MESSAGE_UPDATE", `Dispatching action: ${action.type}`, action);
      dispatch(action);
    },
    [dispatch],
  );

  const {
    messages,
    messageOrder,
    isPending,
    lastLoadedCount,
    apiMessagesResponse,
  } = chatState;

  // Log state values when in debug mode
  useEffect(() => {
    throttledLog("Chat state updated:", {
      messagesCount: Object.keys(messages).length,
      messageOrderLength: messageOrder.length,
      apiMessagesResponse,
      isPending,
    });
  }, [messages, messageOrder, apiMessagesResponse, isPending]);

  // Update React Query cache when chat state changes
  useUpdateEffect(() => {
    if (!currentSessionId) return;

    // Don't cache temporary sessions
    if (currentSessionId.startsWith("temp-")) return;

    // Only cache if we have messages
    if (Object.keys(messages).length === 0) return;

    queryClient.setQueryData(["chatSession", currentSessionId], {
      messages,
      messageOrder,
      lastUpdated: Date.now(),
    });

    throttledLog(
      `Updated cache for session ${currentSessionId} with ${messageOrder.length} messages`,
    );
  }, [messages, messageOrder, currentSessionId]);

  // Enhanced messages query using the generated API hook
  const {
    data: messagesData,
    isLoading: isLoadingMessages,
    refetch: refetchMessages,
  } = useChatMessages(
    currentSessionId && !currentSessionId.startsWith("temp-")
      ? {
          pathParams: { chatId: currentSessionId },
          queryParams: { limit: MESSAGE_PAGE_SIZE },
        }
      : reactQuery.skipToken,
    {
      select: (data) => data,
      enabled: !!currentSessionId && !currentSessionId.startsWith("temp-"),
      staleTime: 30000, // 30 seconds
      gcTime: 5 * 60 * 1000, // 5 minutes
    },
  );

  // Determine if we can load more messages and handle pagination manually
  const hasNextPage = messagesData?.stats.has_more ?? false;
  const isFetchingNextPage = false; // We'll manage this state manually when implementing fetchNextPage

  // Function to load older messages - using the generated API
  const loadOlderMessages = useCallback(() => {
    if (!hasNextPage || isPending || !currentSessionId || !messagesData) {
      log(
        hasNextPage ? "Already loading messages" : "No more messages to load",
      );
      return;
    }

    log("Loading older messages");

    // Set loading state first for better UI feedback
    dispatch({ type: "SET_LOADING", isPending: true });

    // Calculate the next offset based on current data
    const nextOffset =
      messagesData.stats.current_offset + messagesData.stats.returned_count;

    // Use the chatMessagesQuery function from the generated API
    const { queryFn } = chatMessagesQuery({
      pathParams: { chatId: currentSessionId },
      queryParams: {
        limit: MESSAGE_PAGE_SIZE,
        offset: nextOffset,
      },
    });

    // Execute the query function
    queryFn({ signal: new AbortController().signal })
      .then((olderMessagesData) => {
        // Process the older messages
        const newMessages: MessageMap = {};
        const newMessageIds: string[] = [];

        // Messages come in descending order (newest first), but we want ascending
        const pageMessages = [...olderMessagesData.messages].reverse();

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
          type: "SET_LAST_LOADED_COUNT",
          count: olderMessagesData.messages.length,
        });

        dispatch({
          type: "SET_API_RESPONSE",
          response: olderMessagesData,
        });
      })
      .catch((error) => {
        console.error("Error loading older messages:", error);
      })
      .finally(() => {
        dispatch({ type: "SET_LOADING", isPending: false });
      });
  }, [hasNextPage, isPending, currentSessionId, messagesData, messages]);

  // Process messages from the data
  useEffect(() => {
    if (!messagesData || !currentSessionId) return;

    // Handle the messages
    const newMessages: MessageMap = {};
    const newMessageIds: string[] = [];

    if (Object.keys(messages).length === 0) {
      log("Processing messages for initial load");

      // Messages come in descending order (newest first), but we want ascending
      const pageMessages = [...messagesData.messages].reverse();

      pageMessages.forEach((apiMessage) => {
        const message = convertApiMessageToAppMessage(apiMessage);
        if (!(message.id in newMessages)) {
          newMessages[message.id] = message;
          newMessageIds.push(message.id);
        }
      });

      if (newMessageIds.length > 0) {
        dispatch({
          type: "SET_MESSAGES",
          messages: newMessages,
          messageOrder: newMessageIds,
        });
      }

      // Update pagination state
      dispatch({
        type: "SET_LAST_LOADED_COUNT",
        count: messagesData.messages.length,
      });

      dispatch({
        type: "SET_API_RESPONSE",
        response: messagesData,
      });
    }
  }, [messagesData, currentSessionId, messages]);

  // Update loading state
  useEffect(() => {
    dispatch({
      type: "SET_LOADING",
      isPending: isLoadingMessages || isFetchingNextPage,
    });
  }, [isLoadingMessages, isFetchingNextPage]);

  // Reference for files to be attached to next message
  const messageFilesRef = useRef<{ id: string; filename: string }[]>([]);

  // Use the file upload hook at the provider level
  const {
    uploadFiles,
    isUploading: isUploadingFiles,
    error: uploadError,
  } = useFileUpload({
    onUploadSuccess: (files) => {
      // Store the files for the next message
      messageFilesRef.current = files.map((file) => ({
        id: file.id,
        filename: file.filename,
      }));
    },
    onUploadError: (error) => {
      console.error("File upload error:", error);
      // Error is already captured in the uploadError state from useFileUpload
    },
  });

  // Helper to add messages to local state
  const addMessage = useCallback(
    (message: ChatMessage) => {
      loggedDispatch({ type: "ADD_MESSAGE", message });
    },
    [loggedDispatch],
  );

  // Helper to update messages in local state
  const updateMessage = useCallback(
    (messageId: string, updates: Partial<ChatMessage>) => {
      loggedDispatch({ type: "UPDATE_MESSAGE", messageId, updates });
    },
    [loggedDispatch],
  );

  // Update messages based on streaming state
  useEffect(() => {
    if (
      currentStreamingMessageId === null ||
      !currentSessionId ||
      messageOrder.length < 2
    ) {
      // Log why we're not updating
      if (currentStreamingMessageId && !currentSessionId) {
        console.log(
          "%c⚠️ No current session ID to update message for",
          "background: #121; color: #fc3; font-size: 12px; padding: 2px 6px; border-radius: 3px;",
        );
      }
      if (currentStreamingMessageId && messageOrder.length < 2) {
        console.log(
          "%c⚠️ Not enough messages to update",
          "background: #121; color: #fc3; font-size: 12px; padding: 2px 6px; border-radius: 3px;",
          { messageCount: messageOrder.length },
        );
      }
      return;
    }

    try {
      // Get the last message ID which should be the assistant message
      const assistantMessageId = messageOrder[messageOrder.length - 1];
      const currentMessage = messages[assistantMessageId];

      // Make sure it's actually an assistant message
      if (
        !currentMessage ||
        currentMessage.sender !== "assistant" ||
        !currentMessage.loading
      ) {
        debugLog(
          "MESSAGE_UPDATE",
          "No suitable assistant message found to update",
          {
            messageOrder,
            lastMessageId: assistantMessageId,
            currentMessage: currentMessage
              ? {
                  sender: currentMessage.sender,
                  hasLoading: !!currentMessage.loading,
                }
              : null,
          },
        );
        return;
      }

      // If this is the streaming message, update it
      if (streamingMessages[currentStreamingMessageId]) {
        const streamingMessage = streamingMessages[currentStreamingMessageId];

        debugLog(
          "MESSAGE_UPDATE",
          "Updating assistant message with streaming content",
          {
            messageId: assistantMessageId,
            streamingContent: streamingMessage.content.substring(0, 20) + "...",
            streamingStatus,
          },
        );

        if (streamingStatus === "completed") {
          if (ENABLE_VERBOSE_DEBUG) {
            console.log(
              "%c📝 UPDATING MESSAGE AFTER STREAM COMPLETE",
              "background: #121; color: #0f6; font-size: 12px; padding: 2px 6px; border-radius: 3px;",
              {
                messageId: assistantMessageId,
                content: streamingMessage.content.substring(0, 30) + "...",
                streamingStatus,
                currentLoading: currentMessage.loading,
              },
            );
          }

          debugLog(
            "MESSAGE_UPDATE",
            "Stream is complete, updating assistant message",
          );

          // CRITICAL FIX: Always update both content and loading state together.
          // The issue with disappearing messages was caused by:
          // 1. The asynchronous nature of state updates
          // 2. The original implementation using setTimeout which created a race condition
          // 3. The loading state being removed after the content was updated in separate operations
          //
          // By updating both content and loading state in a single operation:
          // - We ensure atomic updates that prevent the race condition
          // - The message stays visible after streaming is complete
          // - Cache consistency is maintained by immediately updating the query cache
          updateMessage(assistantMessageId, {
            content: streamingMessage.content,
            loading: undefined,
          });

          // Save message to React Query cache to persist across refreshes
          throttledLog(
            `Saving completed messages to cache for session ${currentSessionId}`,
          );

          // CRITICAL FIX: Ensure consistency between messages state and cache
          queryClient.setQueryData(["chatSession", currentSessionId], {
            messages: {
              ...messages,
              [assistantMessageId]: {
                ...messages[assistantMessageId],
                content: streamingMessage.content,
                loading: undefined,
              },
            },
            messageOrder,
            lastUpdated: Date.now(),
          });
        } else if (
          streamingStatus === "active" ||
          streamingStatus === "connecting"
        ) {
          // Just update the content but keep loading state
          updateMessage(assistantMessageId, {
            content: streamingMessage.content,
            loading: { state: "loading" },
          });
        }
      }
    } catch (error) {
      console.error("Error in streaming effect:", error);
    }
  }, [
    currentStreamingMessageId,
    streamingMessages,
    streamingStatus,
    currentSessionId,
    messages,
    messageOrder,
    updateMessage,
    queryClient,
  ]);

  // Function to handle file uploads for a message
  const handleFileAttachments = (files: { id: string; filename: string }[]) => {
    // Store the files for the next message
    messageFilesRef.current = files;
  };

  // Expose the uploadFiles function as part of context
  const performFileUpload = (files: File[]) => {
    return uploadFiles(files);
  };

  // Modify the sendMessage function to use our new context
  const sendMessage = useCallback(
    async (content: string): Promise<void> => {
      if (!content.trim() && !messageFilesRef.current.length) {
        return; // Don't send empty messages without attachments
      }

      // Generate a unique ID for the new messages
      const userMessageId = generateMessageId();
      const assistantMessageId = generateMessageId();

      // Get the current time for message creation
      const now = new Date();

      // Get the last message ID, if any
      let lastMessageId: string | undefined;
      if (messageOrder.length > 0) {
        lastMessageId = messageOrder[messageOrder.length - 1];
      }

      // Create the user message with any attached files
      const userMessage: ChatMessage = {
        id: userMessageId,
        content,
        sender: "user",
        createdAt: now,
        authorId: "user", // TODO: Get actual user ID
        attachments: messageFilesRef.current, // Add any file attachments
      };

      // Clear the attached files for future messages
      const attachedFiles = messageFilesRef.current;
      messageFilesRef.current = [];

      // Add user message to state
      addMessage(userMessage);

      // Create the assistant message with loading state
      const assistantMessage: ChatMessage = {
        id: assistantMessageId,
        content: "",
        sender: "assistant",
        createdAt: new Date(now.getTime() + 1), // 1ms after user message
        authorId: "assistant",
        loading: { state: "loading" },
      };

      // Add assistant message to state
      addMessage(assistantMessage);

      try {
        // Use our new context to send the message
        await contextSendMessage(content, {
          previousMessageId: lastMessageId,
          fileIds: attachedFiles.map((file) => file.id),
        });
      } catch (error) {
        throttledLog("Error sending message:", error);

        // Update the assistant message with the error
        updateMessage(assistantMessageId, {
          loading: undefined,
          error:
            error instanceof Error
              ? error
              : new Error("Failed to send message"),
        });
      }
    },
    [
      currentSessionId,
      messageOrder,
      addMessage,
      updateMessage,
      contextSendMessage,
    ],
  );

  // Calculate if we have older messages inline
  const hasOlderMessages = useMemo(() => {
    if (!apiMessagesResponse) return false;
    return apiMessagesResponse.stats.has_more;
  }, [apiMessagesResponse]);

  // Expose the context values
  const contextValue: ChatContextType = {
    messages,
    messageOrder,
    sendMessage,
    updateMessage,
    loadOlderMessages,
    hasOlderMessages,
    isPending,
    lastLoadedCount,
    apiMessagesResponse,
    handleFileAttachments,
    performFileUpload,
    isUploadingFiles,
    uploadError,
  };

  // Update the handle session ID changes effect
  useUpdateEffect(() => {
    // Skip effect for null session ID
    if (!currentSessionId) return;

    try {
      throttledLog(`Resetting state for session: ${currentSessionId}`);

      // Reset state for new session
      loggedDispatch({ type: "RESET_STATE", sessionId: currentSessionId });

      // For temporary sessions, ensure messages are cleared, but don't refetch
      // This helps prevent redirect loops and loading state issues
      if (currentSessionId.startsWith("temp-")) {
        throttledLog("Handling temp session:", currentSessionId);
        dispatch({
          type: "SET_MESSAGES",
          messages: {},
          messageOrder: [],
        });
        dispatch({ type: "SET_LOADING", isPending: false });
      } else {
        // Only refetch for non-temporary sessions
        // Force refetch with fresh data by invalidating the cache first
        void queryClient.invalidateQueries({
          queryKey: chatMessagesQuery({
            pathParams: { chatId: currentSessionId },
          }).queryKey,
        });
        void refetchMessages();
      }
    } catch (error) {
      throttledLog("Error handling session change:", error);
    }
  }, [currentSessionId, refetchMessages, queryClient]);

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
