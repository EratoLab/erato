import { render } from "@testing-library/react";
import { memo, useContext } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  ChatContextProviders,
  ChatSessionContext,
  useChatContext,
  useChatSession,
  useChatTranscript,
  useChatTranscriptSelector,
  useOptionalChatSession,
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
  const renders = { session: 0, transcript: 0, whole: 0, selected: 0 };
  const seen: {
    session?: ChatSessionValue;
    transcript?: ChatTranscriptValue;
    whole?: ChatContextValue;
    selected?: number;
    pairs: [string | null, Messages][];
  } = { pairs: [] };
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
  const WholeReader = memo(function WholeReader() {
    renders.whole += 1;
    seen.whole = useChatContext();
    return null;
  });
  const SelectingReader = memo(function SelectingReader() {
    renders.selected += 1;
    seen.selected = useChatTranscriptSelector(
      (transcript) => transcript?.messageOrder.length ?? -1,
    );
    return null;
  });
  const PairReader = memo(function PairReader() {
    const { currentChatId } = useChatSession();
    const { messages } = useChatTranscript();
    seen.pairs.push([currentChatId, messages]);
    return null;
  });
  const tree = (value: ChatContextValue) => (
    <ChatContextProviders value={value}>
      <SessionReader />
      <TranscriptReader />
      <WholeReader />
      <SelectingReader />
      <PairReader />
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

    expect(renders).toEqual({
      session: 1,
      transcript: 2,
      whole: 2,
      selected: 1,
    });
    expect(seen.session).toBe(session);
    expect(seen.transcript?.messages).toBe(latest.messages);
    expect(seen.whole).toBe(latest);
    expect(seen.selected).toBe(1);
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

  it("hands a chat switch to session and transcript readers in the same render", () => {
    const first = { reply: reply("Old chat") };
    const { seen, update } = renderProviders(valueFor(first));

    const second = { reply: reply("New chat") };
    update(valueFor(second, { currentChatId: "chat-2" }));

    expect(seen.pairs).toEqual([
      ["chat-1", first],
      ["chat-2", second],
    ]);
  });

  it("re-renders a selecting reader only when what it selects changes", () => {
    const { renders, seen, update } = renderProviders(
      valueFor({ reply: reply("Hel") }),
    );

    update(valueFor({ reply: reply("Hello") }));
    expect(renders.selected).toBe(1);

    update(
      valueFor({
        question: { ...reply("Why?"), id: "question", role: "user" },
        reply: reply("Hello"),
      }),
    );
    expect(renders.selected).toBe(2);
    expect(seen.selected).toBe(2);
  });

  it("reads nothing outside a chat provider", () => {
    const seen: { session?: unknown; selected?: unknown } = {};
    function Reader() {
      seen.session = useOptionalChatSession();
      seen.selected = useChatTranscriptSelector((transcript) => transcript);
      return null;
    }
    render(<Reader />);

    expect(seen).toEqual({ session: null, selected: null });
  });

  it("fills the session context for readers outside the hooks", () => {
    const seen: unknown[] = [];
    const ContextReader = memo(function ContextReader() {
      seen.push(useContext(ChatSessionContext));
      return null;
    });
    let hookSession: unknown;
    function HookReader() {
      hookSession = useChatSession();
      return null;
    }
    const tree = (value: ChatContextValue) => (
      <ChatContextProviders value={value}>
        <ContextReader />
        <HookReader />
      </ChatContextProviders>
    );
    const view = render(tree(valueFor({ reply: reply("Hel") })));
    view.rerender(tree(valueFor({ reply: reply("Hello") })));

    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(hookSession);
  });
});
