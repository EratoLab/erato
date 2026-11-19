import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { useRef } from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { messages as enMessages } from "@/locales/en/messages.json";

import { MessageList } from "./MessageList";

import type { ChatMessage } from "./MessageList";
import type { Messages } from "@lingui/core";

vi.mock("@/hooks/useScrollToBottom", () => ({
  useScrollToBottom: () => ({
    containerRef: useRef<HTMLDivElement>(null),
    isScrolledUp: false,
    isNearTop: false,
    initiallyLoaded: true,
    checkScrollPosition: vi.fn(),
    scrollToBottom: vi.fn(),
  }),
}));

// jsdom has no layout: each row is 100px plus one pixel per character, the
// viewport is 300px, and scrollTop is clamped the way a browser clamps it
// when the content gets shorter.
const VIEWPORT_PX = 300;
const rowHeight = (row: Element) => 100 + (row.textContent?.length ?? 0);
const spacerHeight = (element: HTMLElement) =>
  Number.parseFloat(element.style.height) || 0;

const contentHeight = (content: HTMLElement) =>
  Array.from(content.querySelectorAll("[data-row]")).reduce(
    (sum, row) => sum + rowHeight(row),
    0,
  ) + spacerHeight(content.lastElementChild as HTMLElement);

let resizeTicks: Array<() => void> = [];

beforeAll(() => {
  i18n.load("en", enMessages as unknown as Messages);
  i18n.activate("en");
});

beforeEach(() => {
  resizeTicks = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private readonly callback: () => void) {}
      observe() {
        resizeTicks.push(() => this.callback());
      }
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      if (this.getAttribute("aria-hidden") === "true") {
        return spacerHeight(this);
      }
      return this.querySelector("[data-row]") ? contentHeight(this) : 0;
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

const toProps = (list: ChatMessage[], sessionId: string) => ({
  messages: Object.fromEntries(list.map((entry) => [entry.id, entry])),
  messageOrder: list.map((entry) => entry.id),
  currentSessionId: sessionId,
});

const renderList = (list: ChatMessage[], sessionId = "chat-1") => {
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
          messageRenderer={({ message: entry }) => (
            <div data-row>
              {entry.content
                .map((part) => ("text" in part ? part.text : ""))
                .join("")}
            </div>
          )}
        />
      </I18nProvider>
    </QueryClientProvider>
  );
  const view = render(ui(toProps(list, sessionId)));

  const container = screen.getByTestId("message-list");
  const content = container.querySelector<HTMLElement>(".mx-auto")!;
  let scrollTop = 0;
  const maxScrollTop = () => Math.max(0, contentHeight(content) - VIEWPORT_PX);
  Object.defineProperty(container, "scrollTop", {
    configurable: true,
    get: () => {
      scrollTop = Math.min(scrollTop, maxScrollTop());
      return scrollTop;
    },
    set: (value: number) => {
      scrollTop = Math.min(Math.max(0, value), maxScrollTop());
    },
  });

  const frame = () => resizeTicks.forEach((tick) => tick());
  const scrollToEnd = () => {
    act(() => {
      container.scrollTop = maxScrollTop();
      container.dispatchEvent(new Event("scroll"));
      frame();
    });
  };

  return {
    container,
    scrollToEnd,
    update: (next: ChatMessage[], nextSessionId = sessionId) => {
      view.rerender(ui(toProps(next, nextSessionId)));
      frame();
    },
  };
};

const question = message("u1", "user", 0, "q");
const answer = (text: string) => message("a1", "assistant", 1, text);
const READ_SO_FAR = "x".repeat(1_000);

describe("MessageList keeps the reading position", () => {
  it("while a finished answer drops out until the refetch brings it back", () => {
    const view = renderList([question, answer(READ_SO_FAR)]);
    view.scrollToEnd();
    const readingAt = view.container.scrollTop;
    expect(readingAt).toBeGreaterThan(0);

    view.update([question]);
    expect(view.container.scrollTop).toBe(readingAt);

    view.update([question, answer(`${READ_SO_FAR} and the rest`)]);
    expect(view.container.scrollTop).toBe(readingAt);
  });

  it("while a refetch briefly returns a shorter copy of the answer", () => {
    const view = renderList([question, answer(READ_SO_FAR)]);
    view.scrollToEnd();
    const readingAt = view.container.scrollTop;

    view.update([question, answer("")]);
    expect(view.container.scrollTop).toBe(readingAt);

    view.update([question, answer(READ_SO_FAR)]);
    expect(view.container.scrollTop).toBe(readingAt);
  });

  it("lets go when a different message takes the answer's place", () => {
    const view = renderList([question, answer(READ_SO_FAR)]);
    view.scrollToEnd();

    view.update([question]);
    view.update([question, message("a2", "assistant", 2, "short")]);

    expect(view.container.scrollTop).toBe(0);
  });

  it("does not hold the previous chat's height in another chat", () => {
    const view = renderList([question, answer(READ_SO_FAR)]);
    view.scrollToEnd();

    view.update([message("b1", "user", 0, "other")], "chat-2");

    expect(view.container.scrollTop).toBe(0);
  });

  it("lets go after a while when the answer does not come back", () => {
    vi.useFakeTimers();
    try {
      const view = renderList([question, answer(READ_SO_FAR)]);
      view.scrollToEnd();

      view.update([question]);
      expect(view.container.scrollTop).toBeGreaterThan(0);

      act(() => {
        vi.advanceTimersByTime(5_000);
      });
      expect(view.container.scrollTop).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
