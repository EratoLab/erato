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
      // Fix: Ensure no double slashes by normalizing the URL
      const baseUrl = apiRootUrl.endsWith("/")
        ? apiRootUrl.slice(0, -1)
        : apiRootUrl;
      const sseUrl = `${baseUrl}/v1beta/me/messages/submitstream`;

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
            previous_message_id: chatId !== "new" ? undefined : null,
          }),
        });

        setCurrentSource(source);
        setCurrentStreamingMessage({ content: "", isComplete: false });

        // Handle different event types from the API
        source.addEventListener("text_delta", (e: MessageEvent) => {
          try {
            const data = JSON.parse(
              e.data,
            ) as MessageSubmitStreamingResponseMessage;
            if (data.message_type === "text_delta") {
              setCurrentStreamingMessage((prev) => ({
                content: prev?.content + data.new_text,
                isComplete: false,
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
