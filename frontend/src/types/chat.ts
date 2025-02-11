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

export interface ChatMessage {
  id: string;
  content: string;
  sender: "user" | "assistant";
  createdAt: Date;
  authorId: string;
  loading?: StreamingContext;
}
