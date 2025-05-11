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
): void => {
  if ("chat_id" in responseData && typeof responseData.chat_id === "string") {
    setNewlyCreatedChatId(responseData.chat_id);
    if (process.env.NODE_ENV === "development") {
      console.log(
        "[CHAT_FLOW] Chat created (via SSE), ID stored in state:",
        responseData.chat_id,
      );
    }
  } else {
    console.warn(
      "[CHAT_FLOW] Received chat_created event without a valid chat_id",
    );
  }
};
