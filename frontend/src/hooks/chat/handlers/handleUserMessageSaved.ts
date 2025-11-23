import { createLogger } from "@/utils/debugLogger";

import { useMessagingStore } from "../store/messagingStore";

import type {
  MessageSubmitStreamingResponseUserMessageSaved,
  ContentPart,
  ContentPartText,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const logger = createLogger("EVENT", "handleUserMessageSaved");

/**
 * Extracts text content from ContentPart array
 * @param content Array of ContentPart objects (optional)
 * @returns Combined text from all text parts
 */
function extractTextFromContent(content?: ContentPart[] | null): string {
  if (!content || !Array.isArray(content)) {
    return "";
  }

  return content
    .filter((part) => part.content_type === "text")
    .map((part) => (part as ContentPartText).text)
    .join("");
}

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
export function handleUserMessageSaved(
  responseData: MessageSubmitStreamingResponseUserMessageSaved & {
    message_type: "user_message_saved";
  },
): void {
  const serverConfirmedMessage = responseData.message;
  const serverConfirmedMessageContent = extractTextFromContent(
    serverConfirmedMessage.content,
  );

  // Validation: serverConfirmedMessage should have expected structure
  if (
    !serverConfirmedMessage.id ||
    typeof serverConfirmedMessageContent !== "string"
  ) {
    logger.error("Invalid server-confirmed message structure:", responseData);
    return;
  }

  logger.log(
    `Server confirmed user message. Message ID: ${serverConfirmedMessage.id}, Content: "${serverConfirmedMessageContent.substring(0, 50)}..."`,
  );

  useMessagingStore.setState((prevState) => {
    const newUserMessages = { ...prevState.userMessages };

    // Find the temporary message by its content and 'sending' status
    const tempMessage = Object.values(newUserMessages).find(
      (msg) =>
        msg.role === "user" &&
        msg.content === serverConfirmedMessageContent &&
        msg.status === "sending",
    );

    if (tempMessage?.id) {
      const tempMessageKeyToDelete = tempMessage.id; // This key is the temp-user-id
      delete newUserMessages[tempMessageKeyToDelete]; // Remove message with temp ID

      // Construct the final message object using server data
      const finalUserMessage = {
        id: serverConfirmedMessage.id,
        content: serverConfirmedMessageContent,
        role: serverConfirmedMessage.role as "user", // Role from server, cast as "user"
        createdAt: serverConfirmedMessage.created_at,
        status: "complete" as const, // Message is saved, so status is complete
        input_files_ids: serverConfirmedMessage.input_files_ids,
      };

      newUserMessages[finalUserMessage.id] = finalUserMessage; // Add message with real ID

      if (process.env.NODE_ENV === "development") {
        logger.log(
          `User message ID updated: from ${tempMessageKeyToDelete} to ${finalUserMessage.id}. Content: "${finalUserMessage.content.substring(0, 50)}..."`,
        );
      }
      return { ...prevState, userMessages: newUserMessages };
    } else {
      // If no matching temp message found, log a warning.
      // This could happen if the message was cleared or if there's a mismatch.
      logger.warn(
        `No temporary user message found to update for content: "${serverConfirmedMessageContent.substring(0, 100)}...". This might happen if the message was cleared or if there is a data mismatch.`,
        {
          serverConfirmedMessage,
          previousUserMessages: prevState.userMessages, // Log the state before attempting update
        },
      );
    }
    // If no temp message was found to replace, return the previous state unchanged
    logger.log(
      "No matching temporary message found, returning previous state.",
      {
        serverContent: serverConfirmedMessageContent,
        currentMessages: prevState.userMessages,
      },
    );
    return prevState;
  });
}
