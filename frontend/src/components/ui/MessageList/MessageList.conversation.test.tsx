import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { useRef } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { messages as enMessages } from "@/locales/en/messages.json";

import { MessageList } from "./MessageList";

import type { ChatMessage } from "./MessageList";
import type { ConversationFollow } from "@/hooks/useScrollToBottom";
import type { Messages } from "@lingui/core";

const scrollState = vi.hoisted(() => ({
  isScrolledUp: false,
  isConversationHeld: false,
  conversation: [] as (ConversationFollow | null | undefined)[],
}));

vi.mock("@/hooks/useScrollToBottom", () => ({
  useScrollToBottom: (options: {
    conversation?: ConversationFollow | null;
  }) => {
    scrollState.conversation.push(options.conversation);
    return {
      containerRef: useRef<HTMLDivElement>(null),
      isScrolledUp: scrollState.isScrolledUp,
      isNearTop: false,
      initiallyLoaded: true,
      checkScrollPosition: vi.fn(),
      scrollToBottom: vi.fn(),
      isConversationHeld: scrollState.isConversationHeld,
    };
  },
}));

beforeAll(() => {
  i18n.load("en", enMessages as unknown as Messages);
  i18n.activate("en");
});

beforeEach(() => {
  scrollState.isScrolledUp = false;
  scrollState.isConversationHeld = false;
  scrollState.conversation = [];
});

const message = (
  id: string,
  role: "user" | "assistant",
  minute: number,
  text = id,
): ChatMessage => ({
  id,
  role,
  content: [{ content_type: "text", text }],
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString(),
  sender: role,
  authorId: role === "user" ? "author-1" : "assistant_id",
});

const renderList = (list: ChatMessage[], followsConversation: boolean) => {
  const ui = (next: ChatMessage[]) => (
    <QueryClientProvider client={new QueryClient()}>
      <I18nProvider i18n={i18n}>
        <MessageList
          messages={Object.fromEntries(next.map((entry) => [entry.id, entry]))}
          messageOrder={next.map((entry) => entry.id)}
          currentSessionId="chat-1"
          loadOlderMessages={vi.fn()}
          hasOlderMessages={false}
          isPending={false}
          controlsContext={{}}
          onMessageAction={vi.fn(async () => true)}
          messageRenderer={({ message: entry }) => <div>{entry.id}</div>}
          followsConversation={followsConversation}
        />
      </I18nProvider>
    </QueryClientProvider>
  );
  const view = render(ui(list));
  return { update: (next: ChatMessage[]) => view.rerender(ui(next)) };
};

const lastTurn = () => scrollState.conversation.at(-1)?.turn;

describe("MessageList in audio mode", () => {
  it("hands typed chat no conversation to follow", () => {
    renderList([message("u1", "user", 0)], false);
    expect(scrollState.conversation.every((entry) => entry === null)).toBe(
      true,
    );
  });

  it("starts a new turn for the person's next message, not for the reply streaming in", () => {
    const first = [message("u1", "user", 0), message("a1", "assistant", 1)];
    const view = renderList(first, true);
    const before = lastTurn();

    view.update([
      message("u1", "user", 0),
      message("a1", "assistant", 1, "a1 grows"),
    ]);
    expect(lastTurn()).toBe(before);

    view.update([...first, message("u2", "user", 2)]);
    expect(lastTurn()).not.toBe(before);
  });

  it("keeps the turn when the saved message replaces the optimistic one with the server's id and time", () => {
    const view = renderList(
      [{ ...message("temp-user-1", "user", 0), status: "sending" }],
      true,
    );
    const before = lastTurn();

    view.update([message("u1", "user", 1)]);
    expect(lastTurn()).toBe(before);
  });

  it("starts a new turn when the person edits their last message", () => {
    const sent = message("u1", "user", 0);
    const view = renderList([sent, message("a1", "assistant", 1)], true);
    const before = lastTurn();

    view.update([{ ...message("temp-user-2", "user", 2), status: "sending" }]);
    expect(lastTurn()).not.toBe(before);
  });

  it("shows the new-messages bubble only when the person scrolled away by hand", () => {
    const seen = [message("u1", "user", 0), message("a1", "assistant", 1)];
    scrollState.isScrolledUp = true;
    const view = renderList(seen, true);
    view.update([...seen, message("a2", "assistant", 2)]);
    expect(screen.queryByRole("button", { name: /new message/ })).toBeNull();

    scrollState.isConversationHeld = true;
    view.update(seen);
    view.update([...seen, message("a2", "assistant", 2)]);
    expect(
      screen.getByRole("button", { name: "1 new message" }),
    ).toBeInTheDocument();
  });
});
