/**
 * Types for streaming message functionality
 */

/**
 * Status of the streaming process
 */
export type StreamingStatus =
  | "idle" // No streaming in progress
  | "connecting" // Connecting to stream
  | "active" // Actively receiving stream
  | "completing" // Stream is finalizing
  | "completed" // Stream completed
  | "error" // Stream error
  | "cancelled"; // Stream cancelled by user

/**
 * State for the streaming process
 */
export interface StreamState {
  /** Current status of the streaming process */
  status: StreamingStatus;

  /** ID of the message being streamed (if any) */
  messageId: string | null;

  /** Current content being streamed */
  content: string;

  /** Optional error information if status is 'error' */
  error?: Error;
}

/**
 * Options for the streaming process
 */
export interface StreamOptions {
  /** Signal for aborting the stream */
  signal?: AbortSignal;

  /** Callback when a chunk of content is received */
  onContent?: (content: string) => void;

  /** Callback when streaming is complete */
  onComplete?: (fullContent: string) => void;

  /** Callback when streaming encounters an error */
  onError?: (error: Error) => void;
}
