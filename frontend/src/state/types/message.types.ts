/**
 * Types for the messaging system
 */
import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * Status of a message in the UI
 */
export type MessageStatus =
  | "pending" // Initial state when creating a message
  | "streaming" // Content is being streamed
  | "complete" // Streaming completed successfully
  | "error"; // Error occurred

/**
 * Message senders
 */
export type MessageSender = "user" | "assistant" | "system";

/**
 * A chat message with UI-specific properties
 */
export interface Message {
  /** Unique identifier for the message */
  id: string;

  /** Content of the message */
  content: string;

  /** Who sent the message */
  sender: MessageSender;

  /** When the message was created */
  createdAt: Date;

  /** Current status of the message */
  status: MessageStatus;

  /** Optional error if status is 'error' */
  error?: Error;

  /** File attachments for the message */
  attachments?: FileUploadItem[];

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Mapping of message IDs to message objects
 */
export type MessageMap = Record<string, Message>;
