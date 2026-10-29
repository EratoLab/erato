import { vi } from "vitest";

import { isMessageBlockedByPromptInjection } from "@/types/chat";

import type { ChatContextValue } from "@/providers/ChatProvider";

/**
 * Module body for `vi.mock("@/providers/ChatProvider", ...)`. Tests describe
 * the chat through `useChatContext`; the session and transcript hooks that
 * components read are derived from that one description.
 */
export function createChatProviderMock(
  useChatContext: () => unknown = vi.fn(),
) {
  const useMockedContext = () => useChatContext() as Partial<ChatContextValue>;
  return {
    useChatContext,
    useChatTranscript: useMockedContext,
    useChatSession: () => {
      const value = useMockedContext();
      const order = value.messageOrder ?? [];
      return {
        ...value,
        hasMessages: order.length > 0,
        isLastMessageBlockedByPromptInjection:
          isMessageBlockedByPromptInjection(
            value.messages?.[order.at(-1) ?? ""],
          ),
        getTranscript: useMockedContext,
      };
    },
  };
}
