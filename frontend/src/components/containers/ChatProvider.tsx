import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from "react";
import { StreamingContext } from "../../types/chat";
import { SSE } from "sse.js";
import { env } from "../../app/env";
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

/**
 * Create the ChatContext with no default value, forcing consumers to wrap in ChatProvider.
 */
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

  // Example SSE integration; Should probably be adjusted or moved elsewhere
  useEffect(() => {
    const { apiRootUrl } = env();
    const sseUrl = `${apiRootUrl}v1beta/messages/submitstream`;

    const source = new SSE(sseUrl, {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
      },
    });

    source.addEventListener("open", () => {
      console.log("SSE connection opened");
    });

    source.addEventListener("error", (e: Event) => {
      console.error("SSE error:", e);
    });

    // `message` is default message type. We don't normally send it, but might be good to have as a catch-all
    source.addEventListener("message", (e: MessageEvent) => {
      console.log("SSE message received:", e.data);
    });

    // TODO: register one event listener per message type, and in each of them convert to the appropriate variant of MessageSubmitStreamingResponseMessage
    source.addEventListener("text_delta", (e: MessageEvent) => {
      console.log("SSE message received:", e.data);
    });

    // Start the connection
    source.stream();

    // Cleanup on unmount
    return () => {
      source.close();
    };
  }, []);

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
   * sendMessage adds the user's new message to the state.
   * Later on, we can integrate websocket functionality here to stream responses.
   */
  const sendMessage = useCallback(
    async (content: string) => {
      if (!currentSessionId) return;

      // Add user message
      const userMessage: ChatMessage = {
        id: generateMessageId(),
        content,
        sender: "user",
        createdAt: new Date(),
        authorId: "",
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
        authorId: "",
      };
      addMessage(assistantMessage);

      // Start streaming
      await streamMessage(currentSessionId, content);
    },
    [currentSessionId, streamMessage],
  );

  // Update streaming message content
  useEffect(() => {
    if (currentStreamingMessage && currentSessionId) {
      const lastMessageId = messageOrder[messageOrder.length - 1];
      const lastMessage = messages[lastMessageId];
      if (lastMessage && lastMessage.sender === "assistant") {
        updateMessage(lastMessage.id, {
          content: currentStreamingMessage.content,
          loading: currentStreamingMessage.isComplete
            ? undefined
            : { state: "loading" },
          error: currentStreamingMessage.error,
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

/**
 * useChat is a custom hook that provides easy access to the ChatContext.
 * Ensure that you call this hook within a component wrapped by <ChatProvider>.
 */
export const useChat = (): ChatContextType => {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChat must be used within a ChatProvider");
  }
  return context;
};
