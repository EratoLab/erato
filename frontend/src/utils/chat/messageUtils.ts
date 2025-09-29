import type { Message } from "@/types/chat";

/**
 * Creates an optimistic user message object to be added to the UI immediately.
 * @param content The content of the user message.
 * @param inputFileIds Optional array of input file IDs associated with the message.
 * @returns A message object with a temporary ID and 'sending' status.
 */
export function createOptimisticUserMessage(
  content: string,
  inputFileIds?: string[],
): Message {
  const timestamp = Date.now();
  const tempUserMessageId = `temp-user-${timestamp}`;
  return {
    id: tempUserMessageId,
    content,
    role: "user",
    createdAt: new Date(timestamp).toISOString(),
    status: "sending",
    input_files_ids: inputFileIds,
  };
}

/**
 * Merges API messages with local user messages, prioritizing API messages
 * and de-duplicating user messages based on content.
 * @param apiMessages Messages fetched from the API.
 * @param localUserMessages Messages added locally by the user.
 * @returns A record of unique messages, with API messages taking precedence.
 */
export function mergeDisplayMessages(
  apiMessages: Message[],
  localUserMessages: Message[],
): Record<string, Message> {
  // Track which user messages content from API to prevent duplicates
  const apiUserMessageContents = new Set(
    apiMessages.filter((msg) => msg.role === "user").map((msg) => msg.content),
  );

  const messageMap = new Map<string, Message>();

  // First add all API messages to ensure they take precedence
  apiMessages.forEach((msg) => {
    messageMap.set(msg.id, msg);
  });

  // Then add local messages only if they don't conflict
  localUserMessages.forEach((msg) => {
    if (
      (!messageMap.has(msg.id) || msg.status === "sending") &&
      (msg.role !== "user" || !apiUserMessageContents.has(msg.content))
    ) {
      messageMap.set(msg.id, msg);
    }
  });

  return Object.fromEntries(messageMap.entries());
}

// Define a more specific type for the request body if available from your API schemas
// For now, using a general structure.
export interface SubmitStreamRequestBody {
  user_message: string;
  previous_message_id?: string;
  existing_chat_id?: string;
  input_files_ids?: string[];
  chat_provider_id?: string;
}

/**
 * Constructs the request body for the message submission stream API.
 * @param userMessageContent The content of the user's message.
 * @param inputFileIds Optional array of input file IDs.
 * @param previousMessageId Optional ID of the previous assistant message.
 * @param currentChatId Optional existing chat ID (could be active or silent chat ID).
 * @param modelId Optional chat provider ID for model selection.
 * @returns The request body object.
 */
export function constructSubmitStreamRequestBody(
  userMessageContent: string,
  inputFileIds?: string[],
  previousMessageId?: string,
  currentChatId?: string | null, // Combined chatId or silentChatId
  modelId?: string,
): SubmitStreamRequestBody {
  const body: SubmitStreamRequestBody = {
    user_message: userMessageContent,
  };

  if (previousMessageId) {
    body.previous_message_id = previousMessageId;
  }
  if (currentChatId) {
    body.existing_chat_id = currentChatId;
  }
  if (inputFileIds && inputFileIds.length > 0) {
    body.input_files_ids = inputFileIds;
  }
  if (modelId) {
    body.chat_provider_id = modelId;
  }

  return body;
}
