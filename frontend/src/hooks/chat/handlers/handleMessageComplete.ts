/* eslint-disable @typescript-eslint/no-unnecessary-condition */
import { createLogger } from "@/utils/debugLogger";

import { useMessagingStore } from "../store/messagingStore";

import type { useExplicitNavigation } from "../useExplicitNavigation";
import type {
  MessageSubmitStreamingResponseMessageComplete,
  ContentPart,
  ContentPartText,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const logger = createLogger("EVENT", "handleMessageComplete");

/**
 * Extracts text content from ContentPart array
 * @param content Array of ContentPart objects
 * @returns Combined text from all text parts
 */
function extractTextFromContent(content: ContentPart[]): string {
  if (!content || !Array.isArray(content)) {
    return "";
  }

  return content
    .filter((part) => part.content_type === "text")
    .map((part) => (part as ContentPartText).text)
    .join("");
}

/**
 * Handles the 'assistant_message_completed' event from the streaming API response.
 *
 * This event signifies that the backend has finished streaming the assistant's message.
 * This handler updates the streaming state in the messaging store to reflect completion,
 * setting the final content and the real message ID.
 *
 * @param responseData - The data from the 'assistant_message_completed' SSE event.
 *                       It should contain the final message details, including its real ID.
 * @param explicitNav - Optional explicit navigation handler for triggering navigation
 */
export const handleMessageComplete = (
  responseData: MessageSubmitStreamingResponseMessageComplete & {
    message_type: "assistant_message_completed";
  },
  explicitNav?: ReturnType<typeof useExplicitNavigation>,
): void => {
  const initialStoreState = useMessagingStore.getState();
  const { setStreaming, streaming: currentStreamingState } = initialStoreState;

  const initialUserMessagesObject = initialStoreState.userMessages || {};
  const initialUserMessagesArray = Object.values(initialUserMessagesObject);

  logger.log("BEGIN.", {
    streamingState: JSON.stringify(currentStreamingState),
    userMessagesCount: initialUserMessagesArray.length,
    userMessages: JSON.stringify(initialUserMessagesArray),
    fullInitialStore: JSON.stringify(initialStoreState), // Keep this for context if needed
  });

  // Extract real message data from the backend

  const realMessageData = responseData.message || {};
  // It's assumed that if 'assistant_message_completed' is received,
  // a valid message ID will be present in responseData.message.id or responseData.message_id.
  const realMessageId = realMessageData.id || responseData.message_id;
  const finalContent =
    extractTextFromContent(realMessageData.content || []) ||
    extractTextFromContent(responseData.content || []) ||
    currentStreamingState.content; // Fallback to current streaming content if somehow not in response

  if (process.env.NODE_ENV === "development") {
    // logger.log(
    //   "Assistant message completed. Real ID:",
    //   realMessageId,
    //   "Final content snippet:",
    //   finalContent.substring(0, 50),
    // );
  }

  // Update streaming state to indicate completion
  // Set isFinalizing to true while refetch/cleanup happens
  logger.log(
    `Setting streaming store. Real Message ID: ${realMessageId || null}, isStreaming: false, isFinalizing: true, Final Content: "${finalContent.substring(0, 100)}..."`,
  );
  setStreaming({
    isStreaming: false,
    isFinalizing: true, // Signal that we're in the finalization phase
    content: finalContent,
    currentMessageId: realMessageId || null, // Update to real ID
    toolCalls: {}, // Clear tool calls when message is completed
  });

  // Log state after setStreaming
  const storeAfterSetStreaming = useMessagingStore.getState();
  const finalUserMessagesObject = storeAfterSetStreaming.userMessages || {};
  const finalUserMessagesArray = Object.values(finalUserMessagesObject);

  logger.log("END (after setStreaming).", {
    streamingState: JSON.stringify(storeAfterSetStreaming.streaming),
    userMessagesCount: finalUserMessagesArray.length,
    userMessages: JSON.stringify(finalUserMessagesArray),
    fullStoreAfterSetStreaming: JSON.stringify(storeAfterSetStreaming), // Keep for context
  });

  // Add explicit navigation logic
  if (explicitNav) {
    const store = useMessagingStore.getState();
    const newlyCreatedChatId = store.newlyCreatedChatId;

    if (newlyCreatedChatId) {
      // Check if we're on an assistant page first
      if (
        explicitNav.currentAssistantId &&
        explicitNav.shouldNavigateFromAssistant(newlyCreatedChatId)
      ) {
        logger.log(
          `Message completed on assistant page, navigating to: /a/${explicitNav.currentAssistantId}/${newlyCreatedChatId}`,
        );
        explicitNav.navigateToAssistantChat(
          explicitNav.currentAssistantId,
          newlyCreatedChatId,
          "message_completed",
        );
      }
      // Otherwise check if we should navigate from /chat/new
      else if (explicitNav.shouldNavigateFromNewChat(newlyCreatedChatId)) {
        logger.log(
          `Message completed, triggering navigation to: /chat/${newlyCreatedChatId}`,
        );
        explicitNav.performNavigation(newlyCreatedChatId, "message_completed");
      }
    }
  }
};
