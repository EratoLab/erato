import { vi } from "vitest";

import { isMessageBlockedByPromptInjection } from "@/types/chat";
import { shallowEqual } from "@/utils/chat/stableValues";

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
  const transcriptOf = (value: MockedChat): ChatTranscriptValue => ({
    messages: value.messages ?? {},
    messageOrder: value.messageOrder ?? [],
    streamingContent: value.streamingContent ?? [],
  });
  const useMockedContext = () =>
    useChatContext() as MockedChat | null | undefined;
  // Read when called, as the real getTranscript is, from the test's chat now.
  const useLatestTranscript = () => transcriptOf(useMockedContext() ?? {});
  // As the real provider does, the session keeps its object while only the
  // transcript changes.
  let lastSession: ChatSessionValue | null = null;
  const sessionOf = (value: MockedChat): ChatSessionValue => {
    const {
      messages: _messages,
      messageOrder: _messageOrder,
      streamingContent: _streamingContent,
      ...rest
    } = value;
    const order = value.messageOrder ?? [];
    const next = {
      ...rest,
      hasMessages: order.length > 0,
      isLastMessageBlockedByPromptInjection: isMessageBlockedByPromptInjection(
        value.messages?.[order.at(-1) ?? ""],
      ),
      getTranscript: useLatestTranscript,
    } as ChatSessionValue;
    if (!lastSession || !shallowEqual(lastSession, next)) lastSession = next;
    return lastSession;
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
