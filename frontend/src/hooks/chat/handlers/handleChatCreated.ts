import { useMessagingStore } from "../store/messagingStore";

import type { MessageSubmitStreamingResponseChatCreated } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * Handles the 'chat_created' event from the streaming API response.
 *
 * This function is responsible for processing the event that indicates a new chat
 * has been successfully created on the backend. It extracts the new chat ID
 * from the response and updates the local state to reflect this new ID.
 * This is crucial for navigating the user to the newly created chat or for
 * subsequent API calls that require the chat ID.
 *
 * @param responseData - The data received from the 'chat_created' SSE event.
 *                       It should contain the 'chat_id' of the newly created chat.
 * @param setNewlyCreatedChatId - A state setter function from a React hook (e.g., useState)
 *                                used to store the ID of the newly created chat.
 * @returns void
 */
export const handleChatCreated = (
  responseData: MessageSubmitStreamingResponseChatCreated & {
    message_type: "chat_created";
  },
  setNewlyCreatedChatId: (chatId: string | null) => void,
  streamKey?: string,
): void => {
  if ("chat_id" in responseData && typeof responseData.chat_id === "string") {
    console.log(
      `[DEBUG_REDIRECT] handleChatCreated: Setting newlyCreatedChatId to: ${responseData.chat_id}`,
    );
    setNewlyCreatedChatId(responseData.chat_id);
    if (process.env.NODE_ENV === "development") {
      console.log(
        "[DEBUG_REDIRECT] handleChatCreated: Received chat_created event with Chat ID:",
        responseData.chat_id,
        "Full data:",
        responseData,
      );
    }

    // Set the awaiting flag in the store
    useMessagingStore.getState().setAwaitingFirstStreamChunkForNewChat(true);
    // Also set the newlyCreatedChatId in the store
    useMessagingStore
      .getState()
      .setNewlyCreatedChatIdInStore(responseData.chat_id);
    if (streamKey && streamKey !== responseData.chat_id) {
      useMessagingStore
        .getState()
        .moveStreamingState(streamKey, responseData.chat_id);
    }
  } else {
    console.warn(
      "[DEBUG_REDIRECT] handleChatCreated: Received chat_created event without a valid chat_id. Payload:",
      responseData,
    );
  }
};
