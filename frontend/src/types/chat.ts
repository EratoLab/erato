/**
 * Basic types for chat functionality
 * These are placeholder types for the new implementation
 */

export interface Message {
  id: string;
  content: string;
  role: "user" | "assistant" | "system";
  createdAt: string;
  status?: "sending" | "complete" | "error";
  previous_message_id?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  updatedAt: string;
  messages: Message[];
}
