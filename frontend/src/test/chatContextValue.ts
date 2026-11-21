import type { ChatContextValue } from "@/providers/ChatProvider";

/** A chat for `ChatContextProviders` holding only what a test names, and an empty transcript. */
export const testChatValue = (
  value: Partial<ChatContextValue>,
): ChatContextValue =>
  ({
    messages: {},
    messageOrder: [],
    streamingContent: [],
    ...value,
  }) as unknown as ChatContextValue;
