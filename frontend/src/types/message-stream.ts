/**
 * Represents the current state of a streaming message
 */
export interface StreamingMessage {
  content: string;
  isComplete: boolean;
  error?: string;
}

/**
 * Interface for the MessageStream context
 */
export interface MessageStreamContextType {
  currentStreamingMessage: StreamingMessage;
  streamMessage: (sessionId: string, message: string) => Promise<void>;
}
