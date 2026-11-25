import { useEffect, useLayoutEffect, useRef } from "react";

import type { RefObject } from "react";

/** Movement before a touch counts as a drag in one direction. */
const DIRECTION_SLOP_PX = 10;
/** A release faster than this goes the way the finger went, however far. */
const FLICK_PX_PER_MS = 0.35;
const VELOCITY_WINDOW_MS = 100;
const SETTLE_MIN_MS = 150;
const SETTLE_MAX_MS = 300;
// eslint-disable-next-line lingui/no-unlocalized-strings -- CSS value
const SETTLE_EASING = "cubic-bezier(0.2, 0.8, 0.2, 1)";
// eslint-disable-next-line lingui/no-unlocalized-strings -- media query
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export type DragDirection = "horizontal" | "vertical" | null;

/** Null until the finger has moved far enough to tell. */
export function dragDirection(dx: number, dy: number): DragDirection {
  if (Math.hypot(dx, dy) < DIRECTION_SLOP_PX) {
    return null;
  }
  return Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
}

/** `progress` runs from 0 (closed) to 1 (open); `velocity` in px/ms, + is opening. */
export function settlesOpen(progress: number, velocity: number): boolean {
  if (velocity > FLICK_PX_PER_MS) {
    return true;
  }
  if (velocity < -FLICK_PX_PER_MS) {
    return false;
  }
  return progress > 0.5;
}

type Sample = { x: number; t: number };

function releaseVelocity(samples: Sample[]): number {
  const last = samples.at(-1);
  if (!last) {
    return 0;
  }
  const first =
    samples.find((sample) => last.t - sample.t <= VELOCITY_WINDOW_MS) ?? last;
  const dt = last.t - first.t;
  return dt > 0 ? (last.x - first.x) / dt : 0;
}

type Gesture = {
  startX: number;
  startY: number;
  startProgress: number;
  width: number;
  progress: number;
  dragging: boolean;
  samples: Sample[];
};

export interface DrawerSwipeElements {
  drawer: HTMLElement;
  scrim: HTMLElement;
  /** The strip along the left edge; absent when the host keeps that edge. */
  edge: HTMLElement | null;
}

export interface DrawerSwipeHost {
  isOpen: () => boolean;
  onOpen: () => void;
  onClose: () => void;
}

export interface DrawerSwipe {
  /** Call once the drawer's open state has changed in the page. */
  openStateChanged: () => void;
  detach: () => void;
}

/**
 * Touch drags move the drawer with the finger: in from the edge strip, out
 * from the drawer or the scrim beside it. On release it settles open or
 * closed by distance and speed. Mouse input never starts one.
 *
 * Listeners sit only on these elements, not on the document, so touches
 * elsewhere keep the browser's fast scrolling path.
 */
export function attachDrawerSwipe(
  { drawer, scrim, edge }: DrawerSwipeElements,
  host: DrawerSwipeHost,
): DrawerSwipe {
  let gesture: Gesture | null = null;
  // A drag that ended on the other side keeps its inline position until the
  // page has switched state, so the stylesheet never pulls it back meanwhile.
  let releasePending = false;
  let settleTimer: number | undefined;

  const clearPosition = () => {
    drawer.style.transform = "";
    drawer.style.opacity = "";
    scrim.style.opacity = "";
  };
  const clearTransition = () => {
    drawer.style.transition = "";
    scrim.style.transition = "";
  };

  const place = (progress: number, width: number) => {
    // eslint-disable-next-line lingui/no-unlocalized-strings -- CSS value
    drawer.style.transform = `translateX(${(progress - 1) * width}px)`;
    scrim.style.opacity = String(progress);
  };

  const settle = (open: boolean, progress: number) => {
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia(REDUCED_MOTION_QUERY).matches;
    const remaining = Math.abs((open ? 1 : 0) - progress);
    const ms = reduceMotion
      ? 0
      : Math.round(SETTLE_MIN_MS + (SETTLE_MAX_MS - SETTLE_MIN_MS) * remaining);
    // eslint-disable-next-line lingui/no-unlocalized-strings -- CSS value
    drawer.style.transition = `transform ${ms}ms ${SETTLE_EASING}, opacity ${ms}ms ${SETTLE_EASING}`;

    scrim.style.transition = `opacity ${ms}ms ${SETTLE_EASING}`;
    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(clearTransition, ms + 50);

    if (open === host.isOpen()) {
      clearPosition();
      return;
    }
    releasePending = true;
    if (open) {
      host.onOpen();
    } else {
      host.onClose();
    }
  };

  const start = (opensFromHere: boolean) => (event: TouchEvent) => {
    if (event.touches.length !== 1) {
      if (gesture?.dragging) {
        settle(gesture.startProgress === 1, gesture.progress);
      }
      gesture = null;
      return;
    }
    if (opensFromHere === host.isOpen()) {
      return;
    }
    const touch = event.touches[0];
    const startProgress = opensFromHere ? 0 : 1;
    gesture = {
      startX: touch.clientX,
      startY: touch.clientY,
      startProgress,
      width: drawer.getBoundingClientRect().width,
      progress: startProgress,
      dragging: false,
      samples: [{ x: touch.clientX, t: event.timeStamp }],
    };
  };

  const move = (event: TouchEvent) => {
    if (!gesture || gesture.width <= 0) {
      return;
    }
    const touch = event.touches[0];
    const dx = touch.clientX - gesture.startX;
    if (!gesture.dragging) {
      const direction = dragDirection(dx, touch.clientY - gesture.startY);
      if (direction === null) {
        return;
      }
      // Vertical: the drawer's list scrolls. Not cancelable: the browser has
      // already started scrolling.
      if (direction === "vertical" || !event.cancelable) {
        gesture = null;
        return;
      }
      gesture.dragging = true;
      window.clearTimeout(settleTimer);
      drawer.style.transition = "none";
      drawer.style.opacity = "1";
      scrim.style.transition = "none";
    }
    event.preventDefault();
    gesture.progress = Math.min(
      1,
      Math.max(0, gesture.startProgress + dx / gesture.width),
    );
    gesture.samples.push({ x: touch.clientX, t: event.timeStamp });
    if (gesture.samples.length > 12) {
      gesture.samples.shift();
    }
    place(gesture.progress, gesture.width);
  };

  const end = (event: TouchEvent) => {
    const ended = gesture;
    gesture = null;
    if (!ended?.dragging) {
      return;
    }
    if (event.type === "touchcancel") {
      settle(ended.startProgress === 1, ended.progress);
      return;
    }
    // No click on the row or the scrim under the lifted finger.
    event.preventDefault();
    // The lift counts: a finger that stopped before it is not a flick.
    const lift = event.changedTouches.item(0);
    if (lift) {
      ended.samples.push({ x: lift.clientX, t: event.timeStamp });
    }
    settle(
      settlesOpen(ended.progress, releaseVelocity(ended.samples)),
      ended.progress,
    );
  };

  const targets: [HTMLElement, boolean][] = [
    [drawer, false],
    [scrim, false],
  ];
  if (edge) {
    targets.push([edge, true]);
  }
  const active = { passive: false } as const;
  const removers = targets.map(([element, opensFromHere]) => {
    const onStart = start(opensFromHere);
    element.addEventListener("touchstart", onStart, { passive: true });
    element.addEventListener("touchmove", move, active);
    element.addEventListener("touchend", end, active);
    element.addEventListener("touchcancel", end);
    return () => {
      element.removeEventListener("touchstart", onStart);
      element.removeEventListener("touchmove", move);
      element.removeEventListener("touchend", end);
      element.removeEventListener("touchcancel", end);
    };
  });

  return {
    openStateChanged: () => {
      if (releasePending) {
        releasePending = false;
        clearPosition();
      }
    },
    detach: () => {
      removers.forEach((remove) => remove());
      window.clearTimeout(settleTimer);
      clearPosition();
      clearTransition();
    },
  };
}

interface SidebarDrawerSwipeOptions {
  /** A narrow screen, where the open sidebar is a drawer over the page. */
  enabled: boolean;
  isOpen: boolean;
  drawerRef: RefObject<HTMLElement | null>;
  scrimRef: RefObject<HTMLElement | null>;
  edgeRef: RefObject<HTMLElement | null>;
  onOpen: () => void;
  onClose: () => void;
}

export function useSidebarDrawerSwipe({
  enabled,
  isOpen,
  drawerRef,
  scrimRef,
  edgeRef,
  onOpen,
  onClose,
}: SidebarDrawerSwipeOptions) {
  const latest = useRef({ isOpen, onOpen, onClose });
  latest.current = { isOpen, onOpen, onClose };
  const swipeRef = useRef<DrawerSwipe | null>(null);

  useLayoutEffect(() => {
    swipeRef.current?.openStateChanged();
  }, [isOpen]);

  useEffect(() => {
    const drawer = drawerRef.current;
    const scrim = scrimRef.current;
    if (!enabled || !drawer || !scrim) {
      return;
    }
    const swipe = attachDrawerSwipe(
      { drawer, scrim, edge: edgeRef.current },
      {
        isOpen: () => latest.current.isOpen,
        onOpen: () => latest.current.onOpen(),
        onClose: () => latest.current.onClose(),
      },
    );
    swipeRef.current = swipe;
    return () => {
      swipe.detach();
      swipeRef.current = null;
    };
  }, [enabled, drawerRef, scrimRef, edgeRef]);
}
