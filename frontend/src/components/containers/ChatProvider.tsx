import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from "react";
import { StreamingContext } from "@/types/chat";
import { useChatHistory } from "./ChatHistoryProvider";
import { useMessageStream } from "./MessageStreamProvider";

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
  sendMessage: (message: string) => void;
  updateMessage: (messageId: string, updates: Partial<ChatMessage>) => void;
  isLoading: boolean;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

interface ChatProviderProps extends React.PropsWithChildren {
  // For storybook/testing only
  initialMessages?: MessageMap;
  initialMessageOrder?: string[];
  // For real API integration
  loadMessages?: () => Promise<{ messages: MessageMap; order: string[] }>;
}

/**
 * ChatProvider is responsible for managing and providing chat state logic.
 */
export const ChatProvider: React.FC<ChatProviderProps> = ({
  children,
  initialMessages = {},
  initialMessageOrder = [],
  loadMessages,
}) => {
  const { currentSessionId } = useChatHistory();
  const { currentStreamingMessage, streamMessage } = useMessageStream();
  const [messages, setMessages] = useState<MessageMap>(initialMessages);
  const [messageOrder, setMessageOrder] =
    useState<string[]>(initialMessageOrder);
  const [isLoading, setIsLoading] = useState(false);

  // Load messages from API if provided
  useEffect(() => {
    if (loadMessages) {
      setIsLoading(true);
      loadMessages()
        .then(({ messages: apiMessages, order }) => {
          setMessages(apiMessages);
          setMessageOrder(order);
        })
        .finally(() => setIsLoading(false));
    }
  }, [loadMessages]);

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

        // Start streaming - pass the current session ID
        await streamMessage(currentSessionId, content);
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
    [currentSessionId, streamMessage, messageOrder, updateMessage],
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

    if (lastAssistantMessage) {
      // Store the current message ID and content to avoid updating unnecessarily
      const messageId = lastAssistantMessage.id;
      const currentContent = messages[messageId]?.content;
      const newContent = currentStreamingMessage.content;

      // Only update if the content has actually changed
      if (
        currentContent !== newContent ||
        !!messages[messageId]?.loading !==
          !currentStreamingMessage.isComplete ||
        !!messages[messageId]?.error !== !!currentStreamingMessage.error
      ) {
        updateMessage(messageId, {
          content: newContent,
          loading: currentStreamingMessage.isComplete
            ? undefined
            : { state: "loading" },
          error:
            currentStreamingMessage.error instanceof Error
              ? currentStreamingMessage.error
              : currentStreamingMessage.error
                ? new Error(currentStreamingMessage.error)
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

  return (
    <ChatContext.Provider
      value={{
        messages,
        messageOrder,
        sendMessage,
        updateMessage,
        isLoading,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
};

export const useChat = (): ChatContextType => {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChat must be used within a ChatProvider");
  }
  return context;
};
