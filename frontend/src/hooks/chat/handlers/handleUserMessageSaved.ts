import { useMessagingStore } from "../store/messagingStore";

import type { MessageSubmitStreamingResponseUserMessageSaved } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Message } from "@/types/chat";

/**
 * Handles the 'user_message_saved' event from the streaming API response.
 *
 * This function is responsible for updating the local message store when the backend
 * confirms that a user's message has been successfully saved. It plays a crucial
 * role in replacing optimistically added user messages (which have temporary IDs)
 * with their server-confirmed counterparts, including their permanent IDs.
 *
 * The process involves:
 * 1. Receiving the event data containing the saved message details from the server.
 * 2. Finding the corresponding temporary message in the Zustand store, typically by
 *    matching content and its 'sending' status.
 * 3. If a match is found, the temporary message is removed from the store.
 * 4. The server-confirmed message (with its real ID and details) is then added to the store.
 * This ensures the UI reflects the authoritative state from the backend.
 *
 * @param responseData - The data from the 'user_message_saved' SSE event.
 *                       Contains `message`, which is a `MessageSubmitMessageResponseSchema`
 *                       object with the details of the saved user message.
 * @returns void
 */
export const handleUserMessageSaved = (
  responseData: MessageSubmitStreamingResponseUserMessageSaved & {
    message_type: "user_message_saved";
  },
): void => {
  const serverConfirmedMessage = responseData.message;

  if (
    !serverConfirmedMessage.id ||
    typeof serverConfirmedMessage.full_text !== "string"
  ) {
    console.warn(
      "[CHAT_FLOW] 'user_message_saved' event received without sufficient message data:",
      responseData,
    );
    return;
  }

  useMessagingStore.setState((prevState) => {
    const newUserMessages = { ...prevState.userMessages };

    // Find the temporary message by its content and 'sending' status
    const tempMessage = Object.values(newUserMessages).find(
      (msg) =>
        msg.role === "user" &&
        msg.content === serverConfirmedMessage.full_text &&
        msg.status === "sending",
    );

    if (tempMessage?.id) {
      const tempMessageKeyToDelete = tempMessage.id; // This key is the temp-user-id
      delete newUserMessages[tempMessageKeyToDelete]; // Remove message with temp ID

      // Construct the final message object using server data
      const finalUserMessage: Message = {
        id: serverConfirmedMessage.id,
        content: serverConfirmedMessage.full_text,
        role: serverConfirmedMessage.role as "user", // Role from server, cast as "user"
        createdAt: serverConfirmedMessage.created_at,
        status: "complete", // Message is saved, so status is complete
        input_files_ids: serverConfirmedMessage.input_files_ids,
      };

      newUserMessages[finalUserMessage.id] = finalUserMessage; // Add message with real ID

      if (process.env.NODE_ENV === "development") {
        console.log(
          `[CHAT_FLOW] User message ID updated: from ${tempMessageKeyToDelete} to ${finalUserMessage.id}. Content: "${finalUserMessage.content.substring(0, 50)}..."`,
        );
      }
      return { ...prevState, userMessages: newUserMessages };
    } else {
      // If no matching temp message found, log a warning.
      // This could happen if the message was cleared or if there's a mismatch.
      console.warn(
        `[CHAT_FLOW] handleUserMessageSaved: No temporary user message found to update for content: "${serverConfirmedMessage.full_text.substring(0, 100)}...". This might happen if the message was cleared or if there is a data mismatch.`,
        "Server confirmed message:",
        serverConfirmedMessage,
        "Current user messages:",
        newUserMessages,
      );
    }
    // If no temp message was found to replace, return the previous state unchanged
    return prevState;
  });
};
