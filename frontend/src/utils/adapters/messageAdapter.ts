import {
  extractToolCallsFromContent,
  type UiToolCall,
} from "./toolCallAdapter";

import type {
  ChatMessage as ApiChatMessage,
  FileUploadItem,
  MessageFeedback,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Message, MessageError } from "@/types/chat";

/**
 * Interface for UI-specific message properties
 * This acts as a bridge between the API message format and UI component requirements
 */
export interface UiChatMessage extends Message {
  sender: string;
  // authorId retained for storybook/tests; not used for permission checks
  authorId: string;
  previous_message_id?: string;
  input_files_ids?: string[];
  files?: FileUploadItem[];
  loading?: {
    state: "typing" | "thinking" | "done" | "error";
    context?: string;
  };
  toolCalls?: UiToolCall[];
  /** Existing feedback for this message, if any */
  feedback?: MessageFeedback;
}

/**
 * Transforms API message format to UI message format
 * @param apiMessage The message from the API
 * @returns A message formatted for UI consumption
 */
export function mapApiMessageToUiMessage(
  apiMessage: ApiChatMessage,
): UiChatMessage {
  const toolCalls = extractToolCallsFromContent(apiMessage.content);
  const error = (apiMessage as ApiChatMessage & { error?: unknown }).error;

  return {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    id: apiMessage.id ?? `temp-api-${Date.now()}`,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    content: apiMessage.content ?? [],
    role: apiMessage.role as "user" | "assistant" | "system",
    sender: apiMessage.role,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    createdAt: apiMessage.created_at ?? new Date().toISOString(),
    authorId: apiMessage.role === "user" ? "user_id" : "assistant_id",
    // map active thread flag
    is_message_in_active_thread: apiMessage.is_message_in_active_thread,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    input_files_ids: apiMessage.input_files_ids || undefined,
    files: apiMessage.files,
    previous_message_id:
      apiMessage.previous_message_id &&
      typeof apiMessage.previous_message_id === "string"
        ? apiMessage.previous_message_id
        : undefined,
    status: "complete",
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    feedback: apiMessage.feedback ?? undefined,
    error: isMessageError(error) ? error : undefined,
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
    input_files_ids: message.input_files_ids ?? undefined,
  };
}

const isMessageError = (error: unknown): error is MessageError => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as {
    error_description?: unknown;
    error_type?: unknown;
  };

  return (
    typeof candidate.error_description === "string" &&
    typeof candidate.error_type === "string"
  );
};

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
