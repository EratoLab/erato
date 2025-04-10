import type { ChatMessage as ApiChatMessage } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Message } from "@/types/chat";

/**
 * Interface for UI-specific message properties
 * This acts as a bridge between the API message format and UI component requirements
 */
export interface UiChatMessage extends Message {
  sender: string;
  authorId: string;
  previous_message_id?: string;
  loading?: {
    state: "typing" | "thinking" | "done" | "error";
    context?: string;
  };
}

/**
 * Transforms API message format to UI message format
 * @param apiMessage The message from the API
 * @returns A message formatted for UI consumption
 */
export function mapApiMessageToUiMessage(
  apiMessage: ApiChatMessage,
): UiChatMessage {
  return {
    id: apiMessage.id || `temp-api-${Date.now()}`,
    content: apiMessage.full_text || "",
    role: apiMessage.role as "user" | "assistant" | "system",
    sender: apiMessage.role,
    createdAt: apiMessage.created_at || new Date().toISOString(),
    authorId: apiMessage.role === "user" ? "user_id" : "assistant_id",
    previous_message_id:
      apiMessage.previous_message_id &&
      typeof apiMessage.previous_message_id === "string"
        ? apiMessage.previous_message_id
        : undefined,
    status: "complete",
  };
}

/**
 * Transforms a basic Message to a UiChatMessage
 * @param message The base message from internal state
 * @returns A message formatted for UI consumption
 */
export function mapMessageToUiMessage(message: Message): UiChatMessage {
  // Fast path for streaming messages to improve performance
  // Avoid unnecessary object spreading and property copying during streaming
  if (message.status === "sending" && message.role === "assistant") {
    return {
      ...message,
      sender: message.role,
      authorId: "assistant_id",
      loading: {
        state: "typing",
      },
    };
  }

  // Normal path for completed messages
  return {
    ...message,
    sender: message.role,
    authorId: message.role === "user" ? "user_id" : "assistant_id",
  };
}

/**
 * Transforms a batch of API messages to UI messages
 * @param apiMessages Array of messages from the API
 * @returns Array of messages formatted for UI consumption
 */
export function mapApiMessagesToUiMessages(
  apiMessages: ApiChatMessage[],
): UiChatMessage[] {
  return apiMessages.map(mapApiMessageToUiMessage);
}
