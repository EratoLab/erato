import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

import type { ChatMessage } from "./MessageList";

// Long enough for the refetch that brings a dropped answer back.
const HOLD_RELEASE_MS = 5_000;

interface Rendered {
  sessionId: string | null;
  order: string[];
  sizes: Map<string, number>;
}

interface Hold {
  sessionId: string | null;
  ids: Set<string>;
  heightPx: number;
}

const contentSize = (message: ChatMessage) =>
  message.content.reduce(
    (size, part) =>
      size +
      1 +
      ("text" in part && typeof part.text === "string" ? part.text.length : 0),
    0,
  );

const snapshot = (
  messages: Record<string, ChatMessage>,
  order: string[],
  sessionId: string | null,
): Rendered => ({
  sessionId,
  order,
  sizes: new Map(order.map((id) => [id, contentSize(messages[id])])),
});

// The same chat lost or shortened its newest messages without anything new
// taking their place: a stream reset, or a refetch that has not caught up yet.
const isRebuildShrink = (previous: Rendered, next: Rendered) =>
  previous.sessionId === next.sessionId &&
  next.order.length > 0 &&
  next.order.length <= previous.order.length &&
  next.order.every((id, index) => previous.order[index] === id) &&
  (next.order.length < previous.order.length ||
    next.order.some(
      (id) => (next.sizes.get(id) ?? 0) < (previous.sizes.get(id) ?? 0),
    ));

/**
 * Keeps the reader's place when a re-render briefly drops or shortens the
 * newest messages (a reattached answer that finishes, a refetch after an
 * offline stop). Without it the list collapses under the scroll position, the
 * browser clamps it to the top, and the content that comes back counts as new.
 *
 * A spacer at the end of the content keeps the previous height until the
 * messages are back, a different message arrives, the chat changes, or a few
 * seconds pass. Auto-scroll is not involved.
 */
export function useKeepScrollPositionOnRebuild({
  containerRef,
  contentRef,
  spacerRef,
  messages,
  messageOrder,
  sessionId,
  contentShown,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  contentRef: React.RefObject<HTMLDivElement | null>;
  spacerRef: React.RefObject<HTMLDivElement | null>;
  messages: Record<string, ChatMessage>;
  messageOrder: string[];
  sessionId: string | null;
  /** The content element mounts only while the list is not empty. */
  contentShown: boolean;
}) {
  const lastHeightPx = useRef(0);
  const lastScrollTop = useRef(0);
  const rendered = useRef<Rendered | null>(null);
  const hold = useRef<Hold | null>(null);
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const release = useCallback(() => {
    hold.current = null;
    if (releaseTimer.current) {
      clearTimeout(releaseTimer.current);
      releaseTimer.current = null;
    }
    if (spacerRef.current) {
      spacerRef.current.style.height = "";
    }
  }, [spacerRef]);

  // Fits the spacer to the held height; reads layout only while holding.
  const fitSpacer = useCallback(() => {
    const active = hold.current;
    const content = contentRef.current;
    const spacer = spacerRef.current;
    if (!active || !content || !spacer) return;
    const naturalPx = content.offsetHeight - spacer.offsetHeight;
    const missingPx = active.heightPx - naturalPx;
    if (missingPx <= 0) {
      release();
      return;
    }
    spacer.style.height = `${missingPx}px`;
  }, [contentRef, release, spacerRef]);

  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    lastScrollTop.current = container.scrollTop;
    lastHeightPx.current = content.offsetHeight;
    const onScroll = () => {
      lastScrollTop.current = container.scrollTop;
    };
    container.addEventListener("scroll", onScroll, { passive: true });

    // Tracks the height between renders without forcing layout on each
    // streamed update.
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            fitSpacer();
            lastHeightPx.current = content.offsetHeight;
          });
    observer?.observe(content);

    return () => {
      container.removeEventListener("scroll", onScroll);
      observer?.disconnect();
      release();
    };
  }, [containerRef, contentRef, contentShown, fitSpacer, release]);

  useLayoutEffect(() => {
    const previous = rendered.current;
    const next = snapshot(messages, messageOrder, sessionId);
    rendered.current = next;

    const active = hold.current;
    if (
      active &&
      (active.sessionId !== sessionId ||
        messageOrder.some((id) => !active.ids.has(id)))
    ) {
      release();
    }

    if (previous && isRebuildShrink(previous, next)) {
      hold.current = {
        sessionId,
        ids: hold.current?.ids ?? new Set(previous.order),
        heightPx: Math.max(hold.current?.heightPx ?? 0, lastHeightPx.current),
      };
      if (releaseTimer.current) clearTimeout(releaseTimer.current);
      releaseTimer.current = setTimeout(release, HOLD_RELEASE_MS);
    }

    if (!hold.current) return;
    fitSpacer();
    const container = containerRef.current;
    if (container && container.scrollTop < lastScrollTop.current) {
      container.scrollTop = lastScrollTop.current;
    }
  }, [containerRef, fitSpacer, messageOrder, messages, release, sessionId]);
}
