import { extractTextFromContent } from "../adapters/contentPartAdapter";

import type {
  ActionFacetRequest,
  DelegationRunMode,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Message } from "@/types/chat";
import type { AssistantMention } from "@/utils/chat/assistantMentions";

/**
 * Creates an optimistic user message object to be added to the UI immediately.
 * @param content The content of the user message.
 * @param inputFileIds Optional array of input file IDs associated with the message.
 * @param mentionedAssistants The mentions resolved at send time; carried so the
 *                            message highlights them before the server echoes
 *                            its own resolved pairs.
 * @returns A message object with a temporary ID and 'sending' status.
 */
export function createOptimisticUserMessage(
  content: string,
  inputFileIds?: string[],
  mentionedAssistants?: AssistantMention[],
): Message {
  const timestamp = Date.now();
  const tempUserMessageId = `temp-user-${timestamp}`;
  return {
    id: tempUserMessageId,
    content: [{ content_type: "text", text: content }],
    role: "user",
    createdAt: new Date(timestamp).toISOString(),
    status: "sending",
    input_files_ids: inputFileIds,
    mentioned_assistants:
      mentionedAssistants && mentionedAssistants.length > 0
        ? mentionedAssistants
        : undefined,
  };
}

/**
 * The anchor message plus every message after it, mirroring the backend, which
 * deactivates the whole tail and reactivates only the new lineage.
 */
export function collectSupersededMessageIds(
  messages: Record<string, Message>,
  anchorMessageId: string,
): string[] {
  const orderedIds = Object.values(messages)
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    )
    .map((message) => message.id);

  const anchorIndex = orderedIds.indexOf(anchorMessageId);
  return anchorIndex >= 0 ? orderedIds.slice(anchorIndex) : [anchorMessageId];
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
  // Build a map of very recent API user message content with their timestamps
  // Only consider messages from the last 5 seconds for deduplication
  // This is tight enough to catch temp→real message transitions (usually < 1s)
  // but allows users to send the same message again quickly
  const recentApiUserMessages = new Map<string, Date>();
  const now = new Date();
  const DEDUP_WINDOW_MS = 5000; // 5 seconds - tight window for temp message matching

  apiMessages
    .filter((msg) => msg.role === "user")
    .forEach((msg) => {
      const createdAt = new Date(msg.createdAt);
      const age = now.getTime() - createdAt.getTime();
      if (age <= DEDUP_WINDOW_MS) {
        const content = extractTextFromContent(msg.content);
        recentApiUserMessages.set(content, createdAt);
      }
    });

  const messageMap = new Map<string, Message>();

  // First add all API messages to ensure they take precedence
  apiMessages.forEach((msg) => {
    messageMap.set(msg.id, msg);
  });

  // Then add local messages only if they don't conflict
  localUserMessages.forEach((msg) => {
    const localCreatedAt = new Date(msg.createdAt);
    const content = extractTextFromContent(msg.content);
    const apiMessageTime = recentApiUserMessages.get(content);

    // A local user message is a duplicate when its content matches a recent API
    // message (within the 5s window above) and their timestamps are within 3s.
    const isDuplicateOfRecentMessage =
      msg.role === "user" &&
      apiMessageTime &&
      Math.abs(localCreatedAt.getTime() - apiMessageTime.getTime()) < 3000;

    if (
      (!messageMap.has(msg.id) || msg.status === "sending") &&
      !isDuplicateOfRecentMessage
    ) {
      messageMap.set(msg.id, msg);
    }
  });

  return Object.fromEntries(messageMap.entries());
}

export interface SubmitStreamRequestBody {
  user_message: string;
  previous_message_id?: string;
  existing_chat_id?: string;
  input_files_ids?: string[];
  chat_provider_id?: string;
  assistant_id?: string;
  selected_facet_ids?: string[];
  action_facet?: ActionFacetRequest;
  mentioned_assistant_ids?: string[];
  delegation_run_mode?: DelegationRunMode;
}

/**
 * Constructs the request body for the message submission stream API.
 * @param userMessageContent The content of the user's message.
 * @param inputFileIds Optional array of input file IDs.
 * @param previousMessageId Optional ID of the previous assistant message.
 * @param currentChatId Optional existing chat ID (could be active or silent chat ID).
 * @param modelId Optional chat provider ID for model selection.
 * @param assistantId Optional assistant ID to associate with the chat.
 * @param mentionedAssistantIds Optional assistants to delegate this turn to.
 * @param delegationRunMode Optional run mode for delegated mentions; left out
 *   for the wire default ("wait").
 * @returns The request body object.
 */
export function constructSubmitStreamRequestBody(
  userMessageContent: string,
  inputFileIds?: string[],
  previousMessageId?: string,
  currentChatId?: string | null, // Combined chatId or silentChatId
  modelId?: string,
  assistantId?: string,
  selectedFacetIds?: string[],
  actionFacet?: ActionFacetRequest,
  mentionedAssistantIds?: string[],
  delegationRunMode?: DelegationRunMode,
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
  if (assistantId) {
    body.assistant_id = assistantId;
  }
  if (selectedFacetIds) {
    body.selected_facet_ids = selectedFacetIds;
  }
  if (actionFacet) {
    body.action_facet = actionFacet;
  }
  if (mentionedAssistantIds && mentionedAssistantIds.length > 0) {
    body.mentioned_assistant_ids = mentionedAssistantIds;
  }
  if (delegationRunMode) {
    body.delegation_run_mode = delegationRunMode;
  }

  return body;
}
