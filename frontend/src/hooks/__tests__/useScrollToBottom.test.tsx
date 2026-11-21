import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CONTENT_RESIZED_EVENT, useScrollToBottom } from "../useScrollToBottom";

const CLIENT_HEIGHT = 500;

const List = ({ autoScrollPaused = false }: { autoScrollPaused?: boolean }) => {
  const { containerRef } = useScrollToBottom({ autoScrollPaused });
  return (
    <div ref={containerRef} data-testid="list">
      <div data-testid="view" />
    </div>
  );
};

/**
 * The list with its layout, which jsdom does not compute: `grow` makes its
 * content taller as a view that grows would, without scrolling it, and
 * `scrollTo` scrolls it as the user would.
 */
const renderList = async (props: { autoScrollPaused?: boolean } = {}) => {
  const view = render(<List {...props} />);
  const list = screen.getByTestId("list");
  let scrollHeight = 2_000;
  let scrollTop = 0;
  const maxScrollTop = () => scrollHeight - CLIENT_HEIGHT;
  Object.defineProperties(list, {
    clientHeight: { get: () => CLIENT_HEIGHT },
    scrollHeight: { get: () => scrollHeight },
    scrollTop: {
      get: () => scrollTop,
      set: (next: number) => {
        scrollTop = Math.max(0, Math.min(next, maxScrollTop()));
      },
    },
  });
  // The list scrolls to its bottom as it opens.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 80));
  });
  list.scrollTop = maxScrollTop();
  fireEvent.scroll(list);

  /** Content grows that says nothing, such as streamed text. */
  const growQuietly = (by: number) => {
    scrollHeight += by;
  };
  const grow = (by: number) => {
    growQuietly(by);
    fireEvent(
      screen.getByTestId("view"),
      new Event(CONTENT_RESIZED_EVENT, { bubbles: true }),
    );
  };
  const scrollTo = (top: number) => {
    list.scrollTop = top;
    fireEvent.scroll(list);
  };
  const distanceFromBottom = () => maxScrollTop() - list.scrollTop;
  return {
    ...view,
    list,
    grow,
    growQuietly,
    scrollTo,
    maxScrollTop,
    distanceFromBottom,
  };
};

describe("useScrollToBottom", () => {
  it("keeps the list at its bottom when a view in it grows while the user is there", async () => {
    const { grow, distanceFromBottom } = await renderList();

    grow(300);
    expect(distanceFromBottom()).toBe(0);
    grow(150);
    expect(distanceFromBottom()).toBe(0);
  });

  it("leaves the list where the user scrolled up to, and follows its bottom again once the user is back there", async () => {
    const { grow, scrollTo, maxScrollTop, list, distanceFromBottom } =
      await renderList();

    scrollTo(maxScrollTop() - 40);
    const reading = list.scrollTop;
    grow(300);
    expect(list.scrollTop).toBe(reading);

    // Down, but not yet to the bottom.
    scrollTo(maxScrollTop() - 100);
    grow(300);
    expect(distanceFromBottom()).toBe(400);

    scrollTo(maxScrollTop());
    grow(300);
    expect(distanceFromBottom()).toBe(0);
  });

  it("keeps following the bottom while the list moves down on its own, short of it", async () => {
    const { grow, growQuietly, scrollTo, list, distanceFromBottom } =
      await renderList();

    // Text streams in below, and the list is on its way down to it, or the
    // browser moves it down to keep what is in view in place.
    growQuietly(600);
    scrollTo(list.scrollTop + 200);
    expect(distanceFromBottom()).toBe(400);

    grow(100);
    expect(distanceFromBottom()).toBe(0);
  });

  it("leaves the list alone while automatic scrolling is paused", async () => {
    const { grow, distanceFromBottom } = await renderList({
      autoScrollPaused: true,
    });

    grow(300);
    expect(distanceFromBottom()).toBe(300);
  });
});
