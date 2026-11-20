import { vi } from "vitest";

import { isMessageBlockedByPromptInjection } from "@/types/chat";

import type {
  ChatContextValue,
  ChatSessionValue,
  ChatTranscriptValue,
} from "@/providers/ChatProvider";

type MockedChat = Partial<ChatContextValue>;

/**
 * Module body for `vi.mock("@/providers/ChatProvider", ...)`. Tests describe
 * the chat through `useChatContext`; the session and transcript hooks that
 * components read are derived from that one description.
 */
export function createChatProviderMock(
  useChatContext: () => unknown = vi.fn(),
) {
  // One session per described chat, as the real provider keeps it while only
  // the transcript changes.
  const sessions = new WeakMap<MockedChat, ChatSessionValue>();
  const useMockedContext = () =>
    useChatContext() as MockedChat | null | undefined;
  const transcriptOf = (value: MockedChat): ChatTranscriptValue => ({
    messages: value.messages ?? {},
    messageOrder: value.messageOrder ?? [],
    streamingContent: value.streamingContent ?? [],
  });
  // Read when called, as the real getTranscript is, from the test's chat now.
  const useLatestTranscript = () => transcriptOf(useMockedContext() ?? {});
  const sessionOf = (value: MockedChat): ChatSessionValue => {
    const known = sessions.get(value);
    if (known) return known;
    const order = value.messageOrder ?? [];
    const session = {
      ...value,
      hasMessages: order.length > 0,
      isLastMessageBlockedByPromptInjection: isMessageBlockedByPromptInjection(
        value.messages?.[order.at(-1) ?? ""],
      ),
      getTranscript: useLatestTranscript,
    } as ChatSessionValue;
    sessions.set(value, session);
    return session;
  };
  const useOptionalChatSession = () => {
    const value = useMockedContext();
    return value ? sessionOf(value) : null;
  };
  return {
    useChatContext,
    useChatTranscript: useLatestTranscript,
    useChatTranscriptSelector: <T>(
      select: (transcript: ChatTranscriptValue | null) => T,
    ) => {
      const value = useMockedContext();
      return select(value ? transcriptOf(value) : null);
    },
    useChatSession: () => sessionOf(useMockedContext() ?? {}),
    useOptionalChatSession,
  };
}
