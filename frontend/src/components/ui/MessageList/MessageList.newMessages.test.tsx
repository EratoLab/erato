import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { messages as enMessages } from "@/locales/en/messages.json";

import { MessageList } from "./MessageList";

import type { ChatMessage } from "./MessageList";
import type { Messages } from "@lingui/core";

const scrollState = vi.hoisted(() => ({
  isScrolledUp: false,
  scrollToBottom: vi.fn(),
  checkScrollPosition: vi.fn(),
}));

vi.mock("@/hooks/useScrollToBottom", () => ({
  useScrollToBottom: () => ({
    containerRef: useRef<HTMLDivElement>(null),
    isScrolledUp: scrollState.isScrolledUp,
    isNearTop: false,
    initiallyLoaded: true,
    checkScrollPosition: scrollState.checkScrollPosition,
    scrollToBottom: scrollState.scrollToBottom,
  }),
}));

beforeAll(() => {
  i18n.load("en", enMessages as unknown as Messages);
  i18n.activate("en");
});

beforeEach(() => {
  scrollState.isScrolledUp = false;
  scrollState.scrollToBottom.mockClear();
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

const toProps = (list: ChatMessage[], sessionId = "chat-1") => ({
  messages: Object.fromEntries(list.map((entry) => [entry.id, entry])),
  messageOrder: list.map((entry) => entry.id),
  currentSessionId: sessionId,
});

const renderList = (list: ChatMessage[], sessionId?: string) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const ui = (props: ReturnType<typeof toProps>) => (
    <QueryClientProvider client={queryClient}>
      <I18nProvider i18n={i18n}>
        <MessageList
          {...props}
          loadOlderMessages={vi.fn()}
          hasOlderMessages={false}
          isPending={false}
          controlsContext={{}}
          onMessageAction={vi.fn(async () => true)}
          messageRenderer={({ message: entry }) => <div>{entry.id}</div>}
        />
      </I18nProvider>
    </QueryClientProvider>
  );
  const view = render(ui(toProps(list, sessionId)));
  return {
    update: (next: ChatMessage[], nextSessionId?: string) =>
      view.rerender(ui(toProps(next, nextSessionId))),
  };
};

const scrollAway = (list: ChatMessage[], sessionId?: string) => {
  const view = renderList(list, sessionId);
  scrollState.isScrolledUp = true;
  view.update(list, sessionId);
  return view;
};

const indicator = () => screen.queryByRole("button", { name: /new message/ });

describe("MessageList new message indicator", () => {
  it("counts replies that arrive below but not the user's own message", () => {
    const seen = [message("u1", "user", 0), message("a1", "assistant", 1)];
    const view = scrollAway(seen);
    expect(indicator()).toBeNull();

    view.update([
      ...seen,
      message("u2", "user", 2),
      message("a2", "assistant", 3),
    ]);

    expect(
      screen.getByRole("button", { name: "1 new message" }),
    ).toBeInTheDocument();
  });

  it("shows the indicator while the last seen reply keeps streaming", () => {
    const user = message("u1", "user", 0);
    const view = scrollAway([user, message("a1", "assistant", 1, "Hel")]);
    expect(indicator()).toBeNull();

    view.update([user, message("a1", "assistant", 1, "Hello, world")]);

    expect(
      screen.getByRole("button", { name: "1 new message" }),
    ).toBeInTheDocument();
  });

  it("counts the streamed reply after its optimistic id is replaced", () => {
    const user = message("u1", "user", 0);
    const view = scrollAway([
      user,
      message("temp-assistant-1", "assistant", 1, ""),
    ]);

    view.update([user, message("a1", "assistant", 1, "Hello")]);

    expect(
      screen.getByRole("button", { name: "1 new message" }),
    ).toBeInTheDocument();
  });

  it("does not carry the baseline over to another chat", () => {
    const view = scrollAway(
      [message("u1", "user", 0), message("a1", "assistant", 1)],
      "chat-1",
    );
    const otherChat = Array.from({ length: 10 }, (_, index) =>
      message(`b${index}`, index % 2 === 0 ? "user" : "assistant", index),
    );

    view.update(otherChat, "chat-2");
    expect(indicator()).toBeNull();

    view.update([...otherChat, message("b10", "assistant", 10)], "chat-2");
    expect(
      screen.getByRole("button", { name: "1 new message" }),
    ).toBeInTheDocument();
  });

  it("counts the reply to an edit that removed the last seen message", () => {
    const kept = [message("u1", "user", 0), message("a1", "assistant", 1)];
    const view = scrollAway([
      ...kept,
      message("u2", "user", 2),
      message("a2", "assistant", 3),
    ]);

    view.update([
      ...kept,
      message("u2-edited", "user", 4),
      message("a3", "assistant", 5),
    ]);

    expect(
      screen.getByRole("button", { name: "1 new message" }),
    ).toBeInTheDocument();
  });

  it("ignores older history loaded above", () => {
    const seen = [message("u5", "user", 5), message("a5", "assistant", 6)];
    const view = scrollAway(seen);

    view.update([
      message("u4", "user", 3),
      message("a4", "assistant", 4),
      ...seen,
    ]);

    expect(indicator()).toBeNull();
  });

  it("scrolls to the bottom when clicked", () => {
    const seen = [message("u1", "user", 0), message("a1", "assistant", 1)];
    const view = scrollAway(seen);
    view.update([
      ...seen,
      message("a2", "assistant", 2),
      message("a3", "assistant", 3),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "2 new messages" }));

    expect(scrollState.scrollToBottom).toHaveBeenCalledTimes(1);
  });
});
