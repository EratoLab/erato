import { skipToken } from "@tanstack/react-query";
import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
} from "react";

import { useChatHistory } from "./ChatHistoryProvider";
import { useMessageStream } from "./MessageStreamProvider";
import { useChatMessages } from "../../lib/generated/v1betaApi/v1betaApiComponents";

import type {
  ChatMessage as APIChatMessage,
  ChatMessagesResponse,
} from "../../lib/generated/v1betaApi/v1betaApiSchemas";
import type { StreamingContext } from "@/types/chat";

// TODO: move later to types folder, that we can align with what we have from the backend programmaticaly
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
  const [messages, setMessages] = useState<MessageMap>(initialMessages);
  const [messageOrder, setMessageOrder] =
    useState<string[]>(initialMessageOrder);
  const [isLoading, setIsLoading] = useState(false);

  // Track message loading state
  const MESSAGE_PAGE_SIZE = 6; // Single source of truth for page size
  const [displayCount, setDisplayCount] = useState(MESSAGE_PAGE_SIZE);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [lastLoadedCount, setLastLoadedCount] = useState(0);

  // Use the chatMessages API to fetch messages when a chat is selected
  // Include pagination params
  const [messageOffset, setMessageOffset] = useState(0);
  const { data: apiMessagesResponse, isLoading: apiLoadingState } =
    useChatMessages(
      currentSessionId && !currentSessionId.startsWith("temp-")
        ? {
            pathParams: { chatId: currentSessionId },
            queryParams: {
              limit: MESSAGE_PAGE_SIZE, // Use the constant
              offset: messageOffset,
            },
          }
        : skipToken,
      {
        enabled: !!currentSessionId && !currentSessionId.startsWith("temp-"),
        staleTime: 30000, // Cache for 30 seconds
      },
    );

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

  // Reset display count and message offset when switching chats
  useEffect(() => {
    setDisplayCount(MESSAGE_PAGE_SIZE); // Use the constant
    setMessageOffset(0); // Reset offset when switching chats
  }, [currentSessionId]);

  // Load messages from API when currentSessionId changes
  useEffect(() => {
    if (
      apiMessagesResponse &&
      apiMessagesResponse.messages.length > 0 &&
      currentSessionId
    ) {
      // Convert API messages to app message format
      const newMessages: MessageMap = {};
      const newOrder: string[] = [];

      // Sort messages by creation time to ensure correct order
      const sortedMessages = [...apiMessagesResponse.messages].sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );

      // Update if there are more messages based on API response stats
      setHasOlderMessages(apiMessagesResponse.stats.has_more);

      // Only display the most recent messages up to displayCount
      const messagesToDisplay = sortedMessages.slice(-displayCount);

      for (const apiMessage of messagesToDisplay) {
        const message = convertApiMessageToAppMessage(apiMessage);
        newMessages[message.id] = message;
        newOrder.push(message.id);
      }

      setMessages(newMessages);
      setMessageOrder(newOrder);
    } else if (currentSessionId?.startsWith("temp-")) {
      // Reset messages for new/temporary sessions
      setMessages({});
      setMessageOrder([]);
      setHasOlderMessages(false);
    }
  }, [
    apiMessagesResponse,
    currentSessionId,
    convertApiMessageToAppMessage,
    displayCount,
  ]);

  // Update the loading state based on API loading
  useEffect(() => {
    setIsLoading(apiLoadingState);
  }, [apiLoadingState]);

  // Function to load older messages
  const loadOlderMessages = useCallback(() => {
    if (apiMessagesResponse?.stats.has_more) {
      // Increment offset to fetch earlier messages
      setMessageOffset((currentOffset) => currentOffset + MESSAGE_PAGE_SIZE);

      // Track how many new messages we loaded
      setLastLoadedCount(apiMessagesResponse.stats.returned_count);
    }
  }, [apiMessagesResponse, MESSAGE_PAGE_SIZE]);

  const updateMessage = useCallback(
    (messageId: string, updates: Partial<ChatMessage>) => {
      setMessages((prev) => ({
        ...prev,
        [messageId]: { ...prev[messageId], ...updates },
      }));
    },
    [],
  );

  /**
   * sendMessage adds the user's new message to the state and triggers streaming.
   */
  const sendMessage = useCallback(
    async (content: string) => {
      if (!currentSessionId) return;

      setIsLoading(true);

      try {
        // Get the last message ID (the most recent non-user message ID, if possible)
        const recentMessages = messageOrder
          .map((id) => messages[id])
          .filter((msg) => msg.sender === "assistant"); // Filter to assistant messages

        // Get the ID of the last assistant message if available
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
          authorId: "user_1", // Match the controlsContext.currentUserId from page.tsx
        };
        addMessage(userMessage);

        // Create placeholder for assistant message
        const assistantMessageId = generateMessageId();
        const assistantMessage: ChatMessage = {
          id: assistantMessageId,
          content: "",
          sender: "assistant",
          createdAt: new Date(),
          loading: { state: "loading" },
          authorId: "assistant",
        };
        addMessage(assistantMessage);

        // Start streaming - pass the current session ID and last message ID
        await streamMessage(currentSessionId, content, lastMessageId);
      } catch (error) {
        console.error("Error sending message:", error);
        // Update the last message to show the error
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
        setIsLoading(false);
      }
    },
    [currentSessionId, streamMessage, messageOrder, updateMessage, messages],
  );

  // Update streaming message content
  useEffect(() => {
    if (!currentStreamingMessage || !currentSessionId) return;

    // Find the last assistant message to update with streaming content
    const assistantMessages = messageOrder
      .map((id) => messages[id])
      .filter((msg) => msg.sender === "assistant");

    const lastAssistantMessage =
      assistantMessages[assistantMessages.length - 1];

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (lastAssistantMessage) {
      // Store the current message ID and content to avoid updating unnecessarily
      const messageId = lastAssistantMessage.id;
      const currentContent = messages[messageId].content;
      const newContent = currentStreamingMessage.content;

      // Only update if the content has actually changed
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
    }
  }, [
    currentStreamingMessage,
    currentSessionId,
    messages,
    messageOrder,
    updateMessage,
  ]);

  const generateMessageId = () => crypto.randomUUID();

  const addMessage = (message: ChatMessage) => {
    setMessages((prev) => ({ ...prev, [message.id]: message }));
    setMessageOrder((prev) => [...prev, message.id]);
  };

  // Memoize the chat context for performance
  const contextValue = useMemo(
    () => ({
      messages,
      messageOrder,
      sendMessage,
      updateMessage,
      loadOlderMessages,
      hasOlderMessages,
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
      hasOlderMessages,
      isLoading,
      lastLoadedCount,
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
