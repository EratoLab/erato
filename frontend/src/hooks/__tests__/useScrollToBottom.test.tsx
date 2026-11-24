import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CONTENT_RESIZED_EVENT, useScrollToBottom } from "../useScrollToBottom";

const SIZES = [
  { name: "desktop", clientHeight: 828 },
  { name: "phone", clientHeight: 772 },
  { name: "add-in pane", clientHeight: 648 },
];

let observers: { callback: () => void; targets: Set<Element> }[] = [];

beforeEach(() => {
  observers = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      private entry: { callback: () => void; targets: Set<Element> };
      constructor(callback: () => void) {
        this.entry = { callback, targets: new Set() };
        observers.push(this.entry);
      }
      observe(target: Element) {
        this.entry.targets.add(target);
      }
      unobserve() {}
      disconnect() {
        this.entry.targets.clear();
      }
    },
  );
});

/** Calls the observers watching `list` itself, or the content inside it. */
const notify = (list: Element, box: boolean) => {
  for (const { callback, targets } of observers) {
    const watches = [...targets].some((target) =>
      box ? target === list : target !== list,
    );
    if (watches) callback();
  }
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

interface ListProps {
  chat?: string;
  turn?: number;
  replying?: boolean;
  isTransitioning?: boolean;
  restingTop?: () => number | null;
  content?: unknown;
}

const List = (props: ListProps) => {
  const { containerRef, scrollToBottom, isScrolledUp } =
    useScrollToBottom(props);
  return (
    <>
      <div
        ref={containerRef}
        data-testid="list"
        data-scrolled-up={String(isScrolledUp)}
      >
        <div data-testid="view" />
      </div>
      <button type="button" onClick={scrollToBottom}>
        new messages
      </button>
    </>
  );
};

/**
 * The list with the layout jsdom does not compute. `grow` and `shrink` change
 * the content as streaming or folding does, and the browser clamps the list
 * like it would; `scrollTo` is the person scrolling.
 */
const renderList = (clientHeight: number, initial: ListProps = {}) => {
  let props: ListProps = { chat: "chat-1", turn: 1, ...initial };
  const view = render(<List {...props} />);
  const list = screen.getByTestId("list");
  let scrollHeight = 4_000;
  let scrollTop = 0;
  let height = clientHeight;
  const bottom = () => scrollHeight - height;
  Object.defineProperties(list, {
    clientHeight: { get: () => height },
    scrollHeight: { get: () => scrollHeight },
    scrollTop: {
      get: () => scrollTop,
      set: (next: number) => {
        scrollTop = Math.max(0, Math.min(next, bottom()));
      },
    },
  });
  // The browser fires a scroll event only when the list moved.
  const resized = (box = false) => {
    const before = scrollTop;
    act(() => notify(list, box));
    if (scrollTop !== before) fireEvent.scroll(list);
  };
  resized();
  return {
    list,
    bottom,
    grow: (by: number) => {
      scrollHeight += by;
      resized();
    },
    shrink: (by: number) => {
      scrollHeight -= by;
      const before = scrollTop;
      list.scrollTop = scrollTop;
      if (scrollTop !== before) fireEvent.scroll(list);
      resized();
    },
    /**
     * The composer shrinks, so the list gets taller and the browser moves it
     * up into bounds, while content grows in the same frame.
     */
    composerShrinksAsContentGrows: (by: number, grows: number) => {
      height += by;
      list.scrollTop = scrollTop;
      scrollHeight += grows;
      fireEvent.scroll(list);
      resized(true);
      resized();
    },
    /** A view in the list scrolls itself into view, downwards. */
    viewScrollsIntoView: (by: number) => {
      scrollHeight += by;
      list.scrollTop = scrollTop + by - 90;
      fireEvent.scroll(list);
      resized();
    },
    /** Content grows that says nothing but its own event. */
    growQuietly: (by: number) => {
      scrollHeight += by;
    },
    scrollTo: (top: number) => {
      list.scrollTop = top;
      fireEvent.scroll(list);
    },
    update: (next: ListProps) => {
      props = { ...props, ...next };
      act(() => view.rerender(<List {...props} />));
    },
    scrolledUp: () => list.getAttribute("data-scrolled-up") === "true",
  };
};

describe.each(SIZES)("useScrollToBottom ($name)", ({ clientHeight }) => {
  it("follows the end at once as content grows, so no scroll ends short", () => {
    const { list, grow, bottom, scrolledUp } = renderList(clientHeight);

    grow(420);
    expect(list.scrollTop).toBe(bottom());
    grow(1_300);
    expect(list.scrollTop).toBe(bottom());
    expect(scrolledUp()).toBe(false);
  });

  it("keeps a view that grows itself at the end", () => {
    const { list, bottom, growQuietly } = renderList(clientHeight);
    growQuietly(500);

    fireEvent(
      screen.getByTestId("view"),
      new Event(CONTENT_RESIZED_EVENT, { bubbles: true }),
    );
    expect(list.scrollTop).toBe(bottom());
  });

  it("leaves the person where they scrolled up to, and follows again once they are back at the end", () => {
    const { list, grow, scrollTo, bottom, scrolledUp } =
      renderList(clientHeight);

    scrollTo(bottom() - 40);
    const reading = list.scrollTop;
    grow(300);
    expect(list.scrollTop).toBe(reading);
    expect(scrolledUp()).toBe(true);

    scrollTo(bottom());
    grow(300);
    expect(list.scrollTop).toBe(bottom());
    expect(scrolledUp()).toBe(false);
  });

  it("does not take the browser moving the list up as content folds for the person scrolling", () => {
    const { list, grow, shrink, bottom, scrolledUp } = renderList(clientHeight);

    shrink(700);
    grow(200);
    expect(list.scrollTop).toBe(bottom());
    expect(scrolledUp()).toBe(false);
  });

  it("does not take the composer shrinking while content grows for the person scrolling", () => {
    const { list, grow, bottom, composerShrinksAsContentGrows, scrolledUp } =
      renderList(clientHeight - 48);

    composerShrinksAsContentGrows(48, 36);
    grow(100);
    expect(list.scrollTop).toBe(bottom());
    expect(scrolledUp()).toBe(false);
  });

  it("keeps following when a card scrolls itself into view above the end", () => {
    const { list, viewScrollsIntoView, bottom, scrolledUp } =
      renderList(clientHeight);

    viewScrollsIntoView(560);
    expect(list.scrollTop).toBe(bottom());
    expect(scrolledUp()).toBe(false);
  });

  it("leaves something the person opens alone once the messages have settled", () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    const { list, grow, bottom } = renderList(clientHeight);
    const before = list.scrollTop;
    expect(before).toBe(bottom());

    vi.spyOn(Date, "now").mockReturnValue(now + 5_000);
    grow(400);
    expect(list.scrollTop).toBe(before);
  });

  it("takes a scroll up in the frame after its own move for the person's", () => {
    const { list, grow, scrollTo, bottom, scrolledUp } =
      renderList(clientHeight);

    grow(24);
    // The pin and the person's scroll arrive as one scroll event.
    scrollTo(bottom() - 10);
    grow(200);
    expect(scrolledUp()).toBe(true);
    expect(list.scrollTop).toBe(bottom() - 210);
  });

  it("moves only as far as the person scrolls down to something they opened after the reply", () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    const { list, grow, scrollTo } = renderList(clientHeight);
    vi.spyOn(Date, "now").mockReturnValue(now + 5_000);
    grow(900);
    const opened = list.scrollTop;

    scrollTo(opened + 100);
    expect(list.scrollTop).toBe(opened + 100);
  });

  it("keeps a wheel step up whose scroll event arrives after the next chunk (WebKit)", () => {
    const { list, grow, bottom, update, scrolledUp } = renderList(clientHeight);

    // The wheel has moved the list; its scroll event is still pending when
    // the next chunk arrives.
    fireEvent.wheel(list, { deltaY: -120 });
    list.scrollTop = bottom() - 120;
    update({ content: 2 });
    grow(40);
    fireEvent.scroll(list);
    expect(scrolledUp()).toBe(true);
    expect(list.scrollTop).toBe(bottom() - 160);
  });

  it("catches up with the end once the person's wheel step turned out to move nothing", () => {
    vi.useFakeTimers();
    const { list, grow, bottom, scrolledUp } = renderList(clientHeight);

    fireEvent.wheel(list, { deltaY: 120 });
    grow(300);
    expect(list.scrollTop).toBe(bottom() - 300);
    act(() => vi.advanceTimersByTime(120));
    expect(list.scrollTop).toBe(bottom());
    expect(scrolledUp()).toBe(false);
  });

  it("keeps following a late image once the next message arrives", () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    const { list, grow, bottom, update, scrolledUp } = renderList(clientHeight);
    vi.spyOn(Date, "now").mockReturnValue(now + 5_000);
    grow(400);

    update({ content: 2 });
    expect(list.scrollTop).toBe(bottom());
    expect(scrolledUp()).toBe(false);
  });

  it("does not hold the stream back for keys typed in the composer", () => {
    const { list, grow, bottom } = renderList(clientHeight);
    const composer = document.createElement("textarea");
    document.body.appendChild(composer);

    fireEvent.keyDown(composer, { key: " " });
    grow(300);
    expect(list.scrollTop).toBe(bottom());
    composer.remove();
  });

  it("brings the view to the person's new turn, also from where they scrolled to", () => {
    const { list, grow, scrollTo, bottom, update } = renderList(clientHeight);

    scrollTo(500);
    grow(300);
    update({ turn: 2 });
    expect(list.scrollTop).toBe(bottom());
  });

  it("holds still while a chat loads, then shows its end", () => {
    const { list, grow, bottom, update } = renderList(clientHeight, {
      isTransitioning: true,
    });

    grow(600);
    expect(list.scrollTop).toBe(0);
    update({ isTransitioning: false });
    expect(list.scrollTop).toBe(bottom());
  });

  it("goes to the end from the new-messages bubble and follows it", () => {
    const { list, grow, scrollTo, bottom } = renderList(clientHeight);

    scrollTo(1_000);
    fireEvent.click(screen.getByText("new messages"));
    grow(500);
    expect(list.scrollTop).toBe(bottom());
  });

  describe("with a resting point above the end (audio mode)", () => {
    const resting = (top: number | null) => () => top;

    it("rests there for the reply to the person's turn, and does not take its own move for theirs", () => {
      const { list, grow, bottom, update, scrolledUp } =
        renderList(clientHeight);

      update({ turn: 2, restingTop: resting(2_600) });
      grow(2_500);
      expect(list.scrollTop).toBe(2_600);
      grow(2_500);
      expect(list.scrollTop).toBe(2_600);
      expect(scrolledUp()).toBe(false);
      expect(bottom()).toBeGreaterThan(2_600);
    });

    it("shows the end of a chat opened in it, and rests in one opened while a reply comes", () => {
      const opened = renderList(clientHeight, { restingTop: resting(1_000) });
      expect(opened.list.scrollTop).toBe(opened.bottom());
      opened.update({ chat: "chat-2", replying: true });
      opened.grow(10);
      expect(opened.list.scrollTop).toBe(1_000);
    });

    it("follows the end once the person scrolls there from the resting point", () => {
      const { list, grow, scrollTo, bottom, update } = renderList(clientHeight);
      update({ turn: 2, restingTop: resting(2_000) });
      grow(10);
      expect(list.scrollTop).toBe(2_000);

      scrollTo(bottom());
      grow(500);
      expect(list.scrollTop).toBe(bottom());
    });

    it("lets the browser keep the text in place for a person who scrolled away from the resting point", () => {
      const { list, grow, scrollTo, update } = renderList(clientHeight);
      update({ turn: 2, restingTop: resting(2_000) });
      grow(10);
      expect(list.style.overflowAnchor).toBe("none");

      scrollTo(2_300);
      expect(list.style.overflowAnchor).toBe("");
    });

    it("leaves the person where they scrolled down to from the resting point", () => {
      const { list, grow, scrollTo, update, scrolledUp } =
        renderList(clientHeight);
      update({ turn: 2, restingTop: resting(2_000) });
      grow(10);

      scrollTo(2_300);
      grow(500);
      expect(list.scrollTop).toBe(2_300);
      expect(scrolledUp()).toBe(true);
    });
  });
});
