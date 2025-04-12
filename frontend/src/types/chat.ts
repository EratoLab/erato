/**
 * Basic types for chat functionality
 * These are placeholder types for the new implementation
 */

export interface Message {
  id: string;
  content: string;
  role: "user" | "assistant" | "system";
  createdAt: string;
  input_files_ids?: string[];
  status?: "sending" | "complete" | "error";
  previous_message_id?: string;
}

// Metadata for a chat session
export interface ChatSessionMetadata {
  ownerId?: string;
  lastMessage?: {
    content: string;
    timestamp: string;
    sender?: "user" | "assistant" | "system";
  };
}

export interface ChatSession {
  id: string;
  title: string;
  updatedAt: string;
  messages: Message[];
  metadata?: ChatSessionMetadata;
}
