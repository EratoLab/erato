import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useScrollToBottom } from "../useScrollToBottom";

import type { ConversationFollow } from "../useScrollToBottom";

const SIZES = [
  { name: "desktop", clientHeight: 828 },
  { name: "phone", clientHeight: 772 },
  { name: "add-in pane", clientHeight: 648 },
];

let resizeCallbacks: (() => void)[] = [];

beforeEach(() => {
  resizeCallbacks = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resizeCallbacks.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const List = ({
  conversation,
}: {
  conversation: ConversationFollow | null;
}) => {
  const { containerRef, scrollToBottom, isConversationHeld } =
    useScrollToBottom({ conversation });
  return (
    <>
      <div
        ref={containerRef}
        data-testid="list"
        data-held={String(isConversationHeld)}
      >
        <div>
          <div data-testid="preview" style={{ overflowY: "auto" }} />
        </div>
      </div>
      <button type="button" onClick={scrollToBottom}>
        new messages
      </button>
    </>
  );
};

/**
 * The list with the layout jsdom does not compute. `grow` makes the page
 * taller as content that mounts or streams does; `scroll` moves the list as
 * the person's own scrolling does, after the wheel or swipe that caused it.
 */
const renderConversation = async (
  clientHeight: number,
  initial: { turn?: string; answerStart?: number | null; audio?: boolean } = {},
) => {
  let scrollHeight = 4_000;
  let scrollTop = 0;
  let answerStart = initial.answerStart ?? null;
  const bottom = () => scrollHeight - clientHeight;
  const conversationFor = (turn: string): ConversationFollow => ({
    turn,
    target: () => answerStart ?? bottom(),
  });
  let turn = initial.turn ?? "chat:1";
  const view = render(
    <List
      conversation={initial.audio === false ? null : conversationFor(turn)}
    />,
  );
  const list = screen.getByTestId("list");
  Object.defineProperties(list, {
    clientHeight: { get: () => clientHeight },
    scrollHeight: { get: () => scrollHeight },
    scrollTop: {
      get: () => scrollTop,
      set: (next: number) => {
        scrollTop = Math.max(0, Math.min(next, bottom()));
      },
    },
  });
  const resize = () => {
    act(() => {
      resizeCallbacks.forEach((callback) => callback());
    });
    fireEvent.scroll(list);
  };
  resize();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 80));
  });

  return {
    list,
    bottom,
    grow: (by: number) => {
      scrollHeight += by;
      resize();
    },
    /** Content shrinks; the browser clamps the list to its new bottom. */
    shrink: (by: number) => {
      scrollHeight -= by;
      list.scrollTop = Math.min(scrollTop, bottom());
      fireEvent.scroll(list);
    },
    scroll: (
      to: number,
      input: "wheel-up" | "wheel-down" | "none" = "wheel-up",
    ) => {
      if (input !== "none") {
        fireEvent.wheel(list, { deltaY: input === "wheel-up" ? -100 : 100 });
      }
      list.scrollTop = to;
      fireEvent.scroll(list);
    },
    setAnswerStart: (top: number | null) => {
      answerStart = top;
    },
    nextTurn: () => {
      turn = `${turn}+`;
      view.rerender(<List conversation={conversationFor(turn)} />);
    },
    startAudio: () => {
      view.rerender(<List conversation={conversationFor(turn)} />);
    },
    held: () => list.getAttribute("data-held") === "true",
  };
};

describe.each(SIZES)(
  "useScrollToBottom in audio mode ($name)",
  ({ clientHeight }) => {
    it("follows the page down at once as it grows, with no smooth scroll that could end short", async () => {
      const { list, grow, bottom } = await renderConversation(clientHeight);

      grow(420);
      expect(list.scrollTop).toBe(bottom());
      grow(1_300);
      expect(list.scrollTop).toBe(bottom());
      expect(list.style.scrollBehavior).not.toBe("smooth");
    });

    it("keeps the start of a long written answer in view instead of chasing its end", async () => {
      const { list, grow, setAnswerStart } =
        await renderConversation(clientHeight);

      setAnswerStart(3_600);
      grow(2_500);
      expect(list.scrollTop).toBe(3_600);
      grow(2_500);
      expect(list.scrollTop).toBe(3_600);
    });

    it("leaves the person where they scrolled up to while the page grows", async () => {
      const { list, grow, scroll, bottom, held } =
        await renderConversation(clientHeight);

      scroll(bottom() - 600);
      grow(800);
      expect(list.scrollTop).toBe(bottom() - 1_400);
      expect(held()).toBe(true);
    });

    it("follows the bottom again once the person is back there, past the answer start", async () => {
      const { list, grow, scroll, bottom, setAnswerStart, held } =
        await renderConversation(clientHeight);
      setAnswerStart(2_000);

      scroll(2_500, "wheel-down");
      expect(held()).toBe(true);
      scroll(bottom(), "wheel-down");
      grow(700);
      expect(list.scrollTop).toBe(bottom());
      expect(held()).toBe(false);
    });

    it("brings the view to a new spoken turn, also from where the person scrolled to", async () => {
      const { list, grow, scroll, bottom, nextTurn } =
        await renderConversation(clientHeight);

      scroll(500);
      grow(300);
      act(() => nextTurn());
      expect(list.scrollTop).toBe(bottom());
    });

    it("does not take the browser clamping the list for the person's scrolling", async () => {
      const { list, grow, shrink, bottom, held } =
        await renderConversation(clientHeight);

      // The lookup rows fold into one line as the answer ends.
      shrink(700);
      grow(200);
      expect(list.scrollTop).toBe(bottom());
      expect(held()).toBe(false);
    });

    it("does not take its own move to the answer start for the person's, right after they scrolled", async () => {
      const { list, grow, bottom, setAnswerStart, held } =
        await renderConversation(clientHeight);

      // A wheel down at the bottom: nothing moves, but the person's input
      // is recent when the list moves itself.
      fireEvent.wheel(list, { deltaY: 100 });
      setAnswerStart(bottom() - 400);
      grow(1_200);
      expect(held()).toBe(false);
      grow(600);
      expect(list.scrollTop).toBe(bottom() - 2_200);
    });

    it("does not take a tap, or a finger drifting on a button, for scrolling", async () => {
      const { list, grow, bottom, held } =
        await renderConversation(clientHeight);

      fireEvent.touchStart(list, { touches: [{ clientX: 100, clientY: 300 }] });
      fireEvent.touchMove(list, { touches: [{ clientX: 101, clientY: 304 }] });
      fireEvent.touchEnd(list);
      grow(200);
      expect(list.scrollTop).toBe(bottom());
      expect(held()).toBe(false);
    });

    it("does not take a sideways swipe across a wide table for scrolling", async () => {
      const { list, grow, bottom, held } =
        await renderConversation(clientHeight);

      fireEvent.touchStart(list, { touches: [{ clientX: 300, clientY: 300 }] });
      fireEvent.touchMove(list, { touches: [{ clientX: 120, clientY: 330 }] });
      grow(200);
      expect(list.scrollTop).toBe(bottom());
      expect(held()).toBe(false);
    });

    it("does not hold the list when the person scrolls a card's own preview box", async () => {
      const { list, grow, bottom, held } =
        await renderConversation(clientHeight);
      const preview = screen.getByTestId("preview");
      Object.defineProperties(preview, {
        clientHeight: { get: () => 160 },
        scrollHeight: { get: () => 600 },
        scrollTop: { get: () => 200 },
      });

      fireEvent.wheel(preview, { deltaY: -100 });
      grow(300);
      expect(list.scrollTop).toBe(bottom());
      expect(held()).toBe(false);
    });

    it("holds the view for scroll keys pressed while the page, not the list, has the focus", async () => {
      const { list, grow, bottom, held } =
        await renderConversation(clientHeight);

      fireEvent.keyDown(document.body, { key: "PageUp" });
      expect(held()).toBe(true);
      list.scrollTop = bottom() - clientHeight;
      fireEvent.scroll(list);
      const reading = list.scrollTop;
      grow(400);
      expect(list.scrollTop).toBe(reading);
    });

    it("leaves arrow keys in a menu elsewhere on the page alone", async () => {
      const { held } = await renderConversation(clientHeight);
      const menu = document.createElement("button");
      document.body.appendChild(menu);

      fireEvent.keyDown(menu, { key: "ArrowUp" });
      fireEvent.keyDown(menu, { key: "Home" });
      expect(held()).toBe(false);
      menu.remove();
    });

    it("does not take Space on a card's button, and the list shrinking after it, for scrolling", async () => {
      const { list, shrink, grow, bottom, setAnswerStart, held } =
        await renderConversation(clientHeight);
      const allow = document.createElement("button");
      list.firstElementChild?.appendChild(allow);

      fireEvent.keyDown(allow, { key: " " });
      shrink(500);
      setAnswerStart(bottom() - 300);
      grow(900);
      expect(held()).toBe(false);
      expect(list.scrollTop).toBe(bottom() - 1_200);
    });

    it("does not take the browser shrinking the list right after a wheel for the person's scrolling", async () => {
      const { list, shrink, grow, bottom, setAnswerStart } =
        await renderConversation(clientHeight);

      fireEvent.wheel(list, { deltaY: 100 });
      shrink(500);
      setAnswerStart(bottom() - 300);
      grow(900);
      expect(list.scrollTop).toBe(bottom() - 1_200);
    });

    it("leaves scroll keys typed in a text field alone", async () => {
      const { held } = await renderConversation(clientHeight);
      const field = document.createElement("textarea");
      document.body.appendChild(field);

      fireEvent.keyDown(field, { key: "ArrowUp" });
      expect(held()).toBe(false);
      field.remove();
    });

    it("lets the browser keep a held reader's text in place, and sets the place itself while following", async () => {
      const { list, scroll, bottom } = await renderConversation(clientHeight);
      expect(list.style.overflowAnchor).toBe("none");

      scroll(bottom() - 600);
      expect(list.style.overflowAnchor).toBe("");
    });

    it("holds the view when an overlay scrollbar moves the list up, which announces nothing", async () => {
      const { list, grow, scroll, bottom, held } =
        await renderConversation(clientHeight);

      scroll(bottom() - 500, "none");
      expect(held()).toBe(true);
      const reading = list.scrollTop;
      grow(300);
      expect(list.scrollTop).toBe(reading);
    });

    it("follows the bottom when the person scrolls there from where the view rests", async () => {
      const { list, grow, scroll, bottom, setAnswerStart } =
        await renderConversation(clientHeight);
      setAnswerStart(2_000);
      grow(10);
      expect(list.scrollTop).toBe(2_000);

      scroll(bottom(), "wheel-down");
      grow(500);
      expect(list.scrollTop).toBe(bottom());
    });

    it("holds the view when the person swipes the page down to read further up", async () => {
      const { list, grow, bottom, held } =
        await renderConversation(clientHeight);

      fireEvent.touchStart(list, { touches: [{ clientX: 100, clientY: 300 }] });
      fireEvent.touchMove(list, { touches: [{ clientX: 102, clientY: 420 }] });
      expect(held()).toBe(true);
      const top = bottom() - 120;
      list.scrollTop = top;
      fireEvent.scroll(list);
      grow(400);
      expect(list.scrollTop).toBe(top);
    });

    it("takes the view to the bottom and keeps it there from the new-messages bubble", async () => {
      const { list, grow, scroll, bottom, setAnswerStart } =
        await renderConversation(clientHeight);

      setAnswerStart(2_000);
      scroll(1_000);
      fireEvent.click(screen.getByText("new messages"));
      grow(500);
      expect(list.scrollTop).toBe(bottom());
    });

    it("keeps the place of a person reading further up when audio mode starts", async () => {
      const { list, grow, scroll, bottom, startAudio } =
        await renderConversation(clientHeight, { audio: false });

      scroll(bottom() - 900);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
      });
      act(() => startAudio());
      const reading = list.scrollTop;
      grow(600);
      expect(list.scrollTop).toBe(reading);
    });
  },
);

describe("useScrollToBottom without audio mode", () => {
  it("watches no size changes, as before", () => {
    render(<List conversation={null} />);
    expect(resizeCallbacks).toHaveLength(0);
  });
});
