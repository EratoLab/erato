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

const scrollState = vi.hoisted(() => ({ scrollToBottom: vi.fn() }));

vi.mock("@/hooks/useScrollToBottom", () => ({
  useScrollToBottom: () => ({
    containerRef: useRef<HTMLDivElement>(null),
    isScrolledUp: false,
    isNearTop: false,
    initiallyLoaded: true,
    checkScrollPosition: vi.fn(),
    scrollToBottom: scrollState.scrollToBottom,
  }),
}));

beforeAll(() => {
  i18n.load("en", enMessages as unknown as Messages);
  i18n.activate("en");
});

beforeEach(() => {
  scrollState.scrollToBottom.mockClear();
});

const message = (
  id: string,
  role: "user" | "assistant",
  minute: number,
  loading?: ChatMessage["loading"],
): ChatMessage => ({
  id,
  role,
  content: [{ content_type: "text", text: id }],
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString(),
  sender: role,
  authorId: role === "user" ? "author-1" : "assistant_id",
  loading,
});

const renderList = (list: ChatMessage[]) => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <I18nProvider i18n={i18n}>
        <MessageList
          messages={Object.fromEntries(list.map((entry) => [entry.id, entry]))}
          messageOrder={list.map((entry) => entry.id)}
          currentSessionId="chat-1"
          loadOlderMessages={vi.fn()}
          hasOlderMessages={false}
          isPending={false}
          controlsContext={{}}
          onMessageAction={vi.fn(async () => true)}
          messageRenderer={({ message: entry }) => <div>{entry.id}</div>}
        />
      </I18nProvider>
    </QueryClientProvider>,
  );
  const container = screen.getByTestId("message-list");
  const scrollTo = (distanceFromBottom: number) => {
    Object.defineProperty(container, "scrollHeight", {
      value: 2000,
      configurable: true,
    });
    Object.defineProperty(container, "clientHeight", {
      value: 500,
      configurable: true,
    });
    container.scrollTop = 1500 - distanceFromBottom;
  };
  return { list: container, scrollTo };
};

describe("MessageList wheel scrolling near the bottom", () => {
  it("leaves the scroll to the browser when nothing is streaming", () => {
    const { list, scrollTo } = renderList([
      message("u1", "user", 0),
      message("a1", "assistant", 1),
    ]);
    scrollTo(40);

    fireEvent.wheel(list, { deltaY: 30 });
    fireEvent.wheel(list, { deltaY: 30 });

    expect(scrollState.scrollToBottom).not.toHaveBeenCalled();
  });

  it("brings back a paused answer once, then leaves the scroll to the browser", () => {
    const { list, scrollTo } = renderList([
      message("u1", "user", 0),
      message("a1", "assistant", 1, { state: "typing" }),
    ]);
    scrollTo(600);
    fireEvent.wheel(list, { deltaY: -30 });
    scrollState.scrollToBottom.mockClear();

    scrollTo(40);
    fireEvent.wheel(list, { deltaY: 30 });
    fireEvent.wheel(list, { deltaY: 30 });

    expect(scrollState.scrollToBottom).toHaveBeenCalledTimes(1);
  });
});
