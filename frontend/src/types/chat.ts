/**
 * Basic types for chat functionality
 * These are placeholder types for the new implementation
 */

import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export interface Message {
  id: string;
  content: ContentPart[];
  role: "user" | "assistant" | "system";
  createdAt: string;
  input_files_ids?: string[];
  status?: "sending" | "complete" | "error";
  previous_message_id?: string;
  // Whether this message is in the active thread per backend lineage logic
  is_message_in_active_thread?: boolean;
}

// Metadata for a chat session
export interface ChatSessionMetadata {
  ownerId?: string;
  lastMessage?: {
    content: string;
    timestamp: string;
    sender?: "user" | "assistant" | "system";
  };
  fileCount?: number;
}

export interface ChatSession {
  id: string;
  title: string;
  updatedAt: string;
  messages: Message[];
  metadata?: ChatSessionMetadata;
  assistantId?: string | null;
}
