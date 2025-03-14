import React, { createContext, useContext, useCallback, useState } from "react";
import { SSE } from "sse.js";

import { env } from "../../app/env";

import type { MessageSubmitStreamingResponseMessage } from "../../lib/generated/v1betaApi/v1betaApiSchemas";

// import type { ChatMessage } from '../../types/chat';

interface StreamingState {
  content: string;
  isComplete: boolean;
  error?: Error;
}

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

const MessageStreamContext = createContext<
  MessageStreamContextType | undefined
>(undefined);

interface MessageStreamProviderProps extends React.PropsWithChildren {
  onChatCreated?: (tempId: string, permanentId: string) => void;
}

interface SSEErrorEvent extends CustomEvent {
  responseCode?: number;
  data?: string;
  source?: unknown;
}

// Debug logging
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

export const MessageStreamProvider: React.FC<MessageStreamProviderProps> = ({
  children,
  onChatCreated,
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

  const resetStreaming = useCallback(() => {
    setCurrentStreamingMessage(null);
  }, []);

  const streamMessage = useCallback(
    async (
      chatId: string,
      userMessageContent: string,
      lastMessageId?: string,
      fileIds: string[] = [],
    ) => {
      // Cancel any existing stream
      cancelStreaming();

      const { apiRootUrl } = env();
      // Fix: Ensure no double slashes by normalizing the URL
      const baseUrl = apiRootUrl.endsWith("/")
        ? apiRootUrl.slice(0, -1)
        : apiRootUrl;
      const sseUrl = `${baseUrl}/v1beta/me/messages/submitstream`;

      const isNewChat = chatId.startsWith("temp-"); // Check if this is a temporary chat

      try {
        const source = new SSE(sseUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          payload: JSON.stringify({
            // Format according to MessageSubmitRequest schema
            user_message: userMessageContent,
            previous_message_id: isNewChat ? null : (lastMessageId ?? null),
            file_ids: fileIds.length > 0 ? fileIds : undefined,
          }),
        });

        throttledLog(`Starting SSE stream to ${sseUrl}`);
        setCurrentSource(source);
        setCurrentStreamingMessage({ content: "", isComplete: false });

        // Handle different event types from the API
        source.addEventListener("text_delta", (e: MessageEvent) => {
          try {
            const data = JSON.parse(
              e.data,
            ) as MessageSubmitStreamingResponseMessage;
            if (data.message_type === "text_delta" && data.new_text) {
              setCurrentStreamingMessage((prev) => ({
                content: (prev?.content ?? "") + data.new_text,
                isComplete: false,
                error: undefined, // Clear any previous errors
              }));
            }
          } catch (error) {
            console.error("Error parsing SSE text_delta event:", error);
          }
        });

        source.addEventListener("message_complete", (e: MessageEvent) => {
          try {
            const data = JSON.parse(
              e.data,
            ) as MessageSubmitStreamingResponseMessage;
            if (data.message_type === "message_complete") {
              setCurrentStreamingMessage(() => ({
                content: data.full_text,
                isComplete: true,
              }));
            }
          } catch (error) {
            console.error("Error parsing SSE message_complete event:", error);
          }
        });

        // Default message handler as fallback
        source.addEventListener("message", (e: MessageEvent) => {
          try {
            // Add validation to check if e.data exists and is not empty
            if (!e.data || typeof e.data !== "string" || e.data.trim() === "") {
              console.warn("SSE message event received with empty data");
              return; // Skip processing this event
            }

            const data = JSON.parse(e.data);
            console.log("SSE generic message received:", data);
            // Only update content if no specific handler caught this event
            if (data.content || data.new_text) {
              setCurrentStreamingMessage((currentState) => ({
                content:
                  currentState?.content + (data.content || data.new_text || ""),
                isComplete: false,
              }));
            }
          } catch (error) {
            console.error(
              "Error parsing SSE message event:",
              error,
              "Raw data:",
              e.data,
            );
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
          console.error("SSE error event:", e);

          // Don't mark as error if it's just the connection closing normally
          // This helps prevent the ERR_INCOMPLETE_CHUNKED_ENCODING error
          const isNormalClose =
            e instanceof CustomEvent &&
            ((e as SSEErrorEvent).responseCode === 200 ||
              (e as SSEErrorEvent).responseCode === 0) &&
            (!(e as SSEErrorEvent).data || (e as SSEErrorEvent).data === "");

          if (!isNormalClose) {
            setCurrentStreamingMessage((prev) =>
              prev
                ? {
                    ...prev,
                    error: new Error("Stream error occurred"),
                    isComplete: true,
                  }
                : null,
            );
          } else {
            // Just finish the stream normally if it's a clean close
            setCurrentStreamingMessage((prev) =>
              prev
                ? {
                    ...prev,
                    isComplete: true,
                  }
                : null,
            );
          }

          // Always clean up the source
          source.close();
          setCurrentSource(null);
        });

        // Add event listener for chat_created event
        source.addEventListener("chat_created", (e: MessageEvent) => {
          try {
            const data = JSON.parse(
              e.data,
            ) as MessageSubmitStreamingResponseMessage;
            if (
              data.message_type === "chat_created" &&
              isNewChat &&
              onChatCreated
            ) {
              // Convert the temporary chat to a permanent one with the server ID
              onChatCreated(chatId, data.chat_id);
            }
          } catch (error) {
            console.error("Error parsing SSE chat_created event:", error);
          }
        });

        // Start the stream
        source.stream();
      } catch (error) {
        console.error("Failed to start streaming:", error);
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
    [cancelStreaming, onChatCreated],
  );

  return (
    <MessageStreamContext.Provider
      value={{
        currentStreamingMessage,
        streamMessage,
        cancelStreaming,
        resetStreaming,
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
