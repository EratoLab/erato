import { useCallback, useEffect, useRef, useState } from "react";

/**
 * What content that changes its own height after it has rendered, such as an
 * interactive view, dispatches from its element, bubbling, when its height
 * has changed: a list the user follows at its bottom stays there.
 */
export const CONTENT_RESIZED_EVENT = "erato:content-resized";

/** How close to its bottom the list counts as being there. */
const AT_BOTTOM_PX = 8;

/**
 * How long after the messages change their content keeps settling (markdown,
 * a card, a view mounting): growth then is followed; growth later, with no
 * reply coming, is the person opening something, and stays where it is.
 */
const SETTLING_MS = 1500;

/**
 * How long after the person's wheel, swipe or scroll key the list leaves the
 * view alone: WebKit can deliver that scroll's event after the next chunk,
 * and a write meanwhile would undo it.
 */
const INPUT_MS = 100;

/* eslint-disable lingui/no-unlocalized-strings -- KeyboardEvent.key constants, not user-facing text. */
const SCROLL_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
]);
/* eslint-enable lingui/no-unlocalized-strings */

/** How close to its top the list counts as near it, for loading history. */
const NEAR_TOP_PX = 50;

interface UseScrollToBottomOptions {
  /**
   * A chat is loading or the list is switching chats: the view holds still,
   * then shows the end of the chat.
   */
  isTransitioning?: boolean;

  /** The chat shown: another one shows its end. */
  chat?: string;

  /** Changes when the person starts a turn: the view follows again, to it. */
  turn?: number;

  /** A reply to the person is coming now, also in a chat just opened. */
  replying?: boolean;

  /** Changes whenever the messages change. */
  content?: unknown;

  /**
   * Where the view rests while it follows, as a scrollTop, when that is not
   * the bottom; null for the bottom.
   */
  restingTop?: (container: HTMLDivElement) => number | null;
}

interface ScrollToBottomResult {
  /** Ref to attach to the scrollable container */
  containerRef: React.RefObject<HTMLDivElement | null>;

  /** Goes to the bottom and follows it again. */
  scrollToBottom: () => void;

  /** Whether the person scrolled away from where the view follows. */
  isScrolledUp: boolean;

  /** Whether the user is near the top of the message list */
  isNearTop: boolean;
}

/**
 * Keeps a chat's view where the conversation is: the list follows its end
 * (or `restingTop`) as content arrives, set at once on every change of size,
 * so it never ends short of content that grew meanwhile. Only the person
 * scrolling away from where the view was put stops it; being back at the
 * bottom, a new turn or a chat that finished loading starts it again.
 */
export function useScrollToBottom({
  isTransitioning = false,
  chat,
  turn,
  replying = false,
  content,
  restingTop,
}: UseScrollToBottomOptions = {}): ScrollToBottomResult {
  const containerRef = useRef<HTMLDivElement>(null);
  const follows = useRef(true);
  // Back at the bottom by hand, or a chat just opened: its end, not a
  // resting point above it.
  const toEnd = useRef(true);
  // Where the list last put the view: the scroll that causes is not the
  // person's.
  const ownTop = useRef<number | null>(null);
  // The view was put above the end (a resting point), not at it.
  const restsAbove = useRef(false);
  // Where the view was at the last scroll or pin, for the direction of the
  // next move.
  const lastTop = useRef(0);
  const changedAt = useRef(0);
  const inputAt = useRef(Number.NEGATIVE_INFINITY);
  // Content grew after it settled (something opened, an image loading) and
  // the view was left above the end: a move down from there is the person's.
  const strayed = useRef(false);
  const retry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const holds = useRef(isTransitioning);
  holds.current = isTransitioning;
  const restingTopRef = useRef(restingTop);
  restingTopRef.current = restingTop;
  const replyingRef = useRef(replying);
  replyingRef.current = replying;
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const [isNearTop, setIsNearTop] = useState(false);

  const setFollows = useCallback((value: boolean) => {
    follows.current = value;
    setIsScrolledUp(!value);
    // A person reading elsewhere keeps the browser's anchoring, which holds
    // their text still as content above changes.
    if (!value && containerRef.current) {
      containerRef.current.style.overflowAnchor = "";
    }
  }, []);

  const pin = useCallback(() => {
    const container = containerRef.current;
    if (!container || !follows.current || holds.current) return;
    const sinceInput = Date.now() - inputAt.current;
    if (sinceInput < INPUT_MS) {
      clearTimeout(retry.current);
      retry.current = setTimeout(pin, INPUT_MS - sinceInput);
      return;
    }
    const bottom = container.scrollHeight - container.clientHeight;
    const resting = toEnd.current
      ? null
      : (restingTopRef.current?.(container) ?? null);
    const top = Math.max(0, Math.min(bottom, resting ?? bottom));
    restsAbove.current = bottom - top > AT_BOTTOM_PX;
    // Resting above the end, the browser must not move the view for content
    // above it: a move down from there is the person's.
    container.style.overflowAnchor = restsAbove.current ? "none" : "";
    if (Math.abs(container.scrollTop - top) < 1) return;
    strayed.current = false;
    container.scrollTop = top;
    ownTop.current = container.scrollTop;
    lastTop.current = container.scrollTop;
  }, []);

  const scrollToBottom = useCallback(() => {
    toEnd.current = true;
    setFollows(true);
    pin();
  }, [pin, setFollows]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // The list's own size (the composer changing height) and its content
    // while it arrives and settles: text streaming, a card or view mounting,
    // an answer folding.
    const box = new ResizeObserver(pin);
    box.observe(container);
    const resizes = new ResizeObserver(() => {
      if (replyingRef.current || Date.now() - changedAt.current < SETTLING_MS)
        pin();
      else strayed.current = true;
    });
    const observeChildren = () => {
      resizes.disconnect();
      for (const child of Array.from(container.children)) {
        resizes.observe(child);
      }
    };
    observeChildren();
    const childrenChange = new MutationObserver(observeChildren);
    childrenChange.observe(container, { childList: true });
    container.addEventListener(CONTENT_RESIZED_EVENT, pin);

    lastTop.current = container.scrollTop;
    // The list's size at the last scroll: a move that comes with a change of
    // size is the browser's.
    let size = {
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
    };
    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      setIsNearTop(scrollTop < NEAR_TOP_PX);
      const movedUp = scrollTop < lastTop.current;
      lastTop.current = scrollTop;
      const before = size;
      size = { scrollHeight, clientHeight };
      const own =
        ownTop.current !== null && Math.abs(scrollTop - ownTop.current) < 1;
      ownTop.current = null;
      if (own || holds.current) return;
      if (scrollHeight - scrollTop - clientHeight <= AT_BOTTOM_PX) {
        // Back at the end, by hand or because content above it went.
        if (!follows.current) {
          toEnd.current = true;
          setFollows(true);
        } else if (restsAbove.current && !movedUp) {
          toEnd.current = true;
        }
        return;
      }
      if (!follows.current) return;
      // Up, while the list stayed the same size: the person. With a change
      // of size it is the browser keeping the list in bounds (the composer
      // shrinking, content folding). Down, away from the end: the person
      // reading on from a resting point, else the browser or a view
      // scrolling itself into view.
      const browser = movedUp
        ? clientHeight > before.clientHeight ||
          scrollHeight < before.scrollHeight
        : !restsAbove.current && !strayed.current;
      if (browser) pin();
      else setFollows(false);
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    const onInput = () => {
      inputAt.current = Date.now();
    };
    // Not keys typed in a field or handled by the page (a menu).
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA");
      if (SCROLL_KEYS.has(event.key) && !typing && !event.defaultPrevented)
        onInput();
    };
    container.addEventListener("wheel", onInput, { passive: true });
    container.addEventListener("touchmove", onInput, { passive: true });
    document.addEventListener("keydown", onKey);

    return () => {
      clearTimeout(retry.current);
      container.removeEventListener("wheel", onInput);
      container.removeEventListener("touchmove", onInput);
      document.removeEventListener("keydown", onKey);
      box.disconnect();
      resizes.disconnect();
      childrenChange.disconnect();
      container.removeEventListener(CONTENT_RESIZED_EVENT, pin);
      container.removeEventListener("scroll", onScroll);
    };
  }, [pin, setFollows]);

  useEffect(() => {
    changedAt.current = Date.now();
    pin();
  }, [content, pin]);

  // The person's new turn brings the view to it, also from where they had
  // scrolled to; its reply may rest above the end.
  const lastTurn = useRef(turn);
  useEffect(() => {
    if (lastTurn.current === turn) return;
    lastTurn.current = turn;
    toEnd.current = false;
    setFollows(true);
    pin();
  }, [turn, pin, setFollows]);

  // A chat opened or finished loading shows its end, unless a reply is
  // coming in it now; after the turn above, as its messages count as turns.
  useEffect(() => {
    if (isTransitioning) return;
    toEnd.current = !replyingRef.current;
    setFollows(true);
    pin();
  }, [chat, isTransitioning, pin, setFollows]);

  return { containerRef, scrollToBottom, isScrolledUp, isNearTop };
}
