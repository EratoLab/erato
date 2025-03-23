import { useEffect } from "react";

import type { ChatMessage } from "@/components/containers/ChatProvider";
import type {
  ChatMessage as APIChatMessage,
  ChatMessagesResponse,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

// Convert API messages to the app's message format
export const convertApiMessageToAppMessage = (
  apiMessage: APIChatMessage,
): ChatMessage => {
  return {
    id: apiMessage.id,
    content: apiMessage.full_text,
    sender: apiMessage.role === "assistant" ? "assistant" : "user",
    createdAt: new Date(apiMessage.created_at),
    authorId: apiMessage.role,
  };
};

// Interface for messaging state
interface MessagingState {
  messages: Record<string, ChatMessage>;
  messageOrder: string[];
}

// Actions for message state updates
type MessageAction =
  | {
      type: "SET_MESSAGES";
      messages: Record<string, ChatMessage>;
      messageOrder: string[];
    }
  | {
      type: "PREPEND_MESSAGES";
      messages: Record<string, ChatMessage>;
      messageIds: string[];
    };

/**
 * Hook to process messages from paginated data
 */
export function useMessageProcessing(
  paginatedMessages: { pages: ChatMessagesResponse[] } | undefined,
  currentSessionId: string | null,
  messagesState: MessagingState,
  dispatch: (action: MessageAction) => void,
  setLastLoadedCount: (count: number) => void,
  setApiMessagesResponse: (response: ChatMessagesResponse | undefined) => void,
) {
  // Process messages from the paginated data
  useEffect(() => {
    if (!paginatedMessages || !currentSessionId) return;

    // Handle all pages in one batch to avoid UI flicker
    const newMessages: Record<string, ChatMessage> = {};
    const newMessageIds: string[] = [];

    // First, clear the current messages if this is a new session
    if (Object.keys(messagesState.messages).length === 0) {
      console.log("Processing all pages of messages for initial load");

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

      setLastLoadedCount(latestPage.messages.length);
      setApiMessagesResponse(latestPage);
    }
    // If we already have messages and are loading more, only process new pages
    else if (paginatedMessages.pages.length > 1) {
      console.log("Processing new pages for pagination");

      // Get the latest page (the one just loaded)
      const latestPage =
        paginatedMessages.pages[paginatedMessages.pages.length - 1];

      // Process messages in reverse order to get oldest first
      const pageMessages = [...latestPage.messages].reverse();

      pageMessages.forEach((apiMessage) => {
        const message = convertApiMessageToAppMessage(apiMessage);
        if (
          !(message.id in messagesState.messages) &&
          !(message.id in newMessages)
        ) {
          newMessages[message.id] = message;
          newMessageIds.push(message.id);
        }
      });

      if (newMessageIds.length > 0) {
        console.log(`Adding ${newMessageIds.length} older messages`);

        // Prepend older messages
        dispatch({
          type: "PREPEND_MESSAGES",
          messages: newMessages,
          messageIds: newMessageIds,
        });
      }

      // Update pagination state
      setLastLoadedCount(latestPage.messages.length);
      setApiMessagesResponse(latestPage);
    }
  }, [
    paginatedMessages,
    currentSessionId,
    messagesState.messages,
    dispatch,
    setLastLoadedCount,
    setApiMessagesResponse,
  ]);
}
