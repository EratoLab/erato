// import { MessageSubmitStreamingResponseMessage } from "../lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * Represents the current state of a streaming message
 */
export interface StreamingMessage {
  content: string;
  isComplete: boolean;
  error?: string | Error;
}

/**
 * Interface for the MessageStream context
 */
export interface MessageStreamContextType {
  currentStreamingMessage: StreamingMessage | null;
  streamMessage: (sessionId: string, message: string) => Promise<void>;
  cancelStreaming: () => void;
}
