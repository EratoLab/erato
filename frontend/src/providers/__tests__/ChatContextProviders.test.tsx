import { render } from "@testing-library/react";
import { memo, useContext } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  ChatContext,
  ChatContextProviders,
  useChatSession,
  useChatTranscript,
} from "@/providers/ChatProvider";

import type {
  ChatContextValue,
  ChatSessionValue,
  ChatTranscriptValue,
} from "@/providers/ChatProvider";

type Messages = ChatContextValue["messages"];

const reply = (text: string, error?: Messages[string]["error"]) =>
  ({
    id: "reply",
    role: "assistant",
    content: [{ content_type: "text", text }],
    createdAt: "2026-01-01T00:00:00Z",
    error,
  }) as unknown as Messages[string];

const sendMessage = vi.fn();
const archiveChat = vi.fn();

const valueFor = (
  messages: Messages,
  overrides: Partial<ChatContextValue> = {},
) =>
  ({
    messages,
    messageOrder: Object.keys(messages),
    streamingContent: "reply" in messages ? messages.reply.content : undefined,
    currentChatId: "chat-1",
    isPendingResponse: true,
    sendMessage,
    archiveChat,
    ...overrides,
  }) as unknown as ChatContextValue;

function renderProviders(initial: ChatContextValue) {
  const renders = { session: 0, transcript: 0, legacy: 0 };
  const seen: {
    session?: ChatSessionValue;
    transcript?: ChatTranscriptValue;
    legacy?: ChatContextValue | null;
  } = {};
  const SessionReader = memo(function SessionReader() {
    renders.session += 1;
    seen.session = useChatSession();
    return null;
  });
  const TranscriptReader = memo(function TranscriptReader() {
    renders.transcript += 1;
    seen.transcript = useChatTranscript();
    return null;
  });
  const LegacyReader = memo(function LegacyReader() {
    renders.legacy += 1;
    seen.legacy = useContext(ChatContext);
    return null;
  });
  const tree = (value: ChatContextValue) => (
    <ChatContextProviders value={value}>
      <SessionReader />
      <TranscriptReader />
      <LegacyReader />
    </ChatContextProviders>
  );
  const view = render(tree(initial));
  return {
    renders,
    seen,
    update: (value: ChatContextValue) => view.rerender(tree(value)),
  };
}

describe("ChatContextProviders", () => {
  it("keeps the session while only the transcript changes and hands handlers the latest one", () => {
    const { renders, seen, update } = renderProviders(
      valueFor({ reply: reply("Hel") }),
    );
    const session = seen.session;

    const latest = valueFor({ reply: reply("Hello") });
    update(latest);

    expect(renders).toEqual({ session: 1, transcript: 2, legacy: 2 });
    expect(seen.session).toBe(session);
    expect(seen.transcript?.messages).toBe(latest.messages);
    expect(seen.legacy).toBe(latest);
    expect(seen.session?.getTranscript().messages).toBe(latest.messages);
    expect(seen.session?.sendMessage).toBe(sendMessage);
  });

  it("gives consumers a new session when a session field changes", () => {
    const messages = { reply: reply("Hello") };
    const { renders, seen, update } = renderProviders(valueFor(messages));

    update(valueFor(messages, { isPendingResponse: false }));

    expect(renders.session).toBe(2);
    expect(seen.session?.isPendingResponse).toBe(false);
  });

  it("derives whether there are messages and whether the last answer was withheld", () => {
    const { seen, update } = renderProviders(valueFor({}));
    expect(seen.session?.hasMessages).toBe(false);
    expect(seen.session?.isLastMessageBlockedByPromptInjection).toBe(false);

    update(
      valueFor({
        reply: reply("", {
          error_type: "content_filter",
          error_description: "Blocked",
          filter_details: { pattern_id: "p1", matched_text: "ignore all" },
        }),
      }),
    );
    expect(seen.session?.hasMessages).toBe(true);
    expect(seen.session?.isLastMessageBlockedByPromptInjection).toBe(true);
  });
});
