/**
 * This is a compatibility layer for the legacy MessageStreamProvider.
 * It exists for backward compatibility while we migrate to the new MessagingProvider.
 */
import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from "react";

// Define the StreamingState type for backward compatibility
interface StreamingState {
  content: string;
  isComplete: boolean;
  error?: Error;
}

// Define the old MessageStreamContext type for backward compatibility
interface MessageStreamContextType {
  currentStreamingMessage: StreamingState | null;
  streamMessage: (
    chatId: string,
    userMessageContent: string,
    lastMessageId?: string,
    fileIds?: string[],
  ) => Promise<void>;
  cancelStreaming: () => void;
  resetStreaming: () => void;
}

// Create the context with the old interface
const MessageStreamContext = createContext<
  MessageStreamContextType | undefined
>(undefined);

// Props for backward compatibility
interface MessageStreamProviderProps extends React.PropsWithChildren {
  onChatCreated?: (tempId: string, permanentId: string) => void;
}

/**
 * Legacy MessageStreamProvider - kept for backward compatibility
 *
 * @deprecated Use MessagingProvider instead
 */
export const MessageStreamProvider: React.FC<MessageStreamProviderProps> = ({
  children,
  onChatCreated,
}) => {
  // Internal state for the streaming message
  const [currentStreamingMessage, setCurrentStreamingMessage] =
    useState<StreamingState | null>(null);

  // Reference to abort controller
  const abortControllerRef = React.useRef<AbortController | null>(null);

  // Create a new abort controller and abort any existing one
  const createAbortController = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    return controller.signal;
  }, []);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  // Cancel streaming function
  const cancelStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    setCurrentStreamingMessage((prev) => {
      if (!prev) return null;
      return { ...prev, isComplete: true };
    });
  }, []);

  // Reset streaming function
  const resetStreaming = useCallback(() => {
    setCurrentStreamingMessage(null);
  }, []);

  // Simplified stream message function
  // This is a minimal implementation that just sets state locally -
  // in a real implementation, this would call the API
  const streamMessage = useCallback(
    async (
      chatId: string,
      userMessageContent: string,
      lastMessageId?: string,
      _fileIds?: string[],
    ) => {
      // Reset any existing streaming
      cancelStreaming();

      // Create a signal for fetch
      const signal = createAbortController();

      // Set initial state
      setCurrentStreamingMessage({ content: "", isComplete: false });

      try {
        console.warn(
          "MessageStreamProvider is deprecated - please use MessagingProvider",
        );
        console.log("Streaming message:", {
          chatId,
          content: userMessageContent,
          lastMessageId,
        });

        // Simulate streaming with timeout
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Only proceed if not aborted
        if (!signal.aborted) {
          // Simulate a streaming message
          setCurrentStreamingMessage({
            content:
              "This is a compatibility response. Please migrate to MessagingProvider.",
            isComplete: true,
          });

          // Simulate chat creation callback
          if (chatId.startsWith("temp-") && onChatCreated) {
            const permanentId = `perm-${Date.now()}`;
            onChatCreated(chatId, permanentId);
          }
        }
      } catch (error) {
        console.error("Error in streamMessage:", error);

        if (!signal.aborted) {
          setCurrentStreamingMessage({
            content: "",
            isComplete: true,
            error: error instanceof Error ? error : new Error("Stream error"),
          });
        }
      }
    },
    [cancelStreaming, createAbortController, onChatCreated],
  );

  // Create the context value
  const contextValue = React.useMemo(
    () => ({
      currentStreamingMessage,
      streamMessage,
      cancelStreaming,
      resetStreaming,
    }),
    [currentStreamingMessage, streamMessage, cancelStreaming, resetStreaming],
  );

  return (
    <MessageStreamContext.Provider value={contextValue}>
      {children}
    </MessageStreamContext.Provider>
  );
};

/**
 * @deprecated Use useMessagingContext from MessagingProvider instead
 */
export const useMessageStream = (): MessageStreamContextType => {
  const context = useContext(MessageStreamContext);
  if (!context) {
    throw new Error(
      "useMessageStream must be used within a MessageStreamProvider",
    );
  }
  return context;
};
