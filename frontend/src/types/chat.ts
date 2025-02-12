export type LoadingState =
  | "idle"
  | "loading"
  | "tool-calling"
  | "reasoning"
  | "error";

export interface StreamingContext {
  state: LoadingState;
  context?: string;
  partialContent?: string;
}

// Base message type that extends the API Message
import type { Message } from "../lib/generated/v1betaApi/v1betaApiSchemas";

export interface ChatMessage extends Message {
  content: string;
  sender: "user" | "assistant";
  createdAt: Date;
  authorId: string;
  loading?: StreamingContext;
}

// Base chat type that extends the API Chat
import type { Chat } from "../lib/generated/v1betaApi/v1betaApiSchemas";

export interface ChatSession extends Chat {
  title: string;
  messages: ChatMessage[];
  createdAt: Date;
  updatedAt: Date;
  metadata?: ChatMetadata;
}

export interface ChatMetadata {
  isShared?: boolean;
  ownerId: string;
  sharedWith?: string[];
  permissions?: ChatPermissions;
  tags?: string[];
  category?: string;
  lastMessage?: {
    content: string;
    createdAt: Date;
    sender: "user" | "assistant";
  };
}

export interface ChatPermissions {
  canEdit: boolean;
  canShare: boolean;
  canDelete: boolean;
}
