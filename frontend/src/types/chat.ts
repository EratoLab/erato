import type {
  Message,
  Chat,
  UserProfile as ApiUserProfile,
} from "../lib/generated/v1betaApi/v1betaApiSchemas";

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

// Extend the API Message with frontend-specific fields
export interface ChatMessage extends Message {
  content: string;
  sender: "user" | "assistant";
  createdAt: Date;
  authorId: string;
  loading?: StreamingContext;
}

// Extend the API Chat with frontend-specific fields
export interface ChatSession extends Chat {
  title: string;
  messages: ChatMessage[];
  createdAt: Date;
  updatedAt: Date;
  metadata?: ChatMetadata;
}

// Extend the API UserProfile with frontend-specific fields
export interface UserProfile extends ApiUserProfile {
  username?: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
  createdAt: string;
  updatedAt: string;
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
  userProfile?: UserProfile;
}

export interface ChatPermissions {
  canEdit: boolean;
  canShare: boolean;
  canDelete: boolean;
}
