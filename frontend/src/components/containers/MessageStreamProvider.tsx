import React, { createContext, useContext, useCallback, useState } from "react";
import { SSE } from "sse.js";
import { env } from "../../app/env";
// import type { ChatMessage } from '../../types/chat';

interface StreamingState {
  content: string;
  isComplete: boolean;
  error?: Error;
}

interface MessageStreamContextType {
  currentStreamingMessage: StreamingState | null;
  streamMessage: (chatId: string, userMessageContent: string) => Promise<void>;
  cancelStreaming: () => void;
}

const MessageStreamContext = createContext<
  MessageStreamContextType | undefined
>(undefined);

export const MessageStreamProvider: React.FC<React.PropsWithChildren> = ({
  children,
}) => {
  const [currentSource, setCurrentSource] = useState<SSE | null>(null);
  const [currentStreamingMessage, setCurrentStreamingMessage] =
    useState<StreamingState | null>(null);

  const cancelStreaming = useCallback(() => {
    if (currentSource) {
      currentSource.close();
      setCurrentSource(null);
      setCurrentStreamingMessage(null);
    }
  }, [currentSource]);

  const streamMessage = useCallback(
    async (chatId: string, userMessageContent: string) => {
      // Cancel any existing stream
      cancelStreaming();

      const { apiRootUrl } = env();
      const sseUrl = `${apiRootUrl}/v1beta/messages/submitstream`;

      try {
        const source = new SSE(sseUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          payload: JSON.stringify({
            chatId,
            content: userMessageContent,
            role: "user",
          }),
        });

        setCurrentSource(source);
        setCurrentStreamingMessage({ content: "", isComplete: false });

        source.addEventListener("message", (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data);
            setCurrentStreamingMessage((prev) => ({
              content: prev?.content + data.content,
              isComplete: false,
            }));
          } catch (error) {
            console.error("Error parsing SSE message:", error);
          }
        });

        source.addEventListener("done", () => {
          setCurrentStreamingMessage((prev) =>
            prev
              ? {
                  ...prev,
                  isComplete: true,
                }
              : null,
          );
          source.close();
          setCurrentSource(null);
        });

        source.addEventListener("error", (e: Event) => {
          setCurrentStreamingMessage((prev) =>
            prev
              ? {
                  ...prev,
                  error: new Error("Stream error occurred"),
                  isComplete: true,
                }
              : null,
          );
          source.close();
          setCurrentSource(null);
        });

        source.stream();
      } catch (error) {
        setCurrentStreamingMessage({
          content: "",
          isComplete: true,
          error:
            error instanceof Error
              ? error
              : new Error("Failed to start streaming"),
        });
      }
    },
    [cancelStreaming],
  );

  return (
    <MessageStreamContext.Provider
      value={{
        currentStreamingMessage,
        streamMessage,
        cancelStreaming,
      }}
    >
      {children}
    </MessageStreamContext.Provider>
  );
};

export const useMessageStream = () => {
  const context = useContext(MessageStreamContext);
  if (!context) {
    throw new Error(
      "useMessageStream must be used within a MessageStreamProvider",
    );
  }
  return context;
};
