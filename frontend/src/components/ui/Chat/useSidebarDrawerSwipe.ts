import { useEffect, useLayoutEffect, useRef } from "react";

import type { RefObject } from "react";

/** Movement before a touch counts as a drag in one direction. */
const DIRECTION_SLOP_PX = 10;
/** A release faster than this goes the way the finger went, however far. */
const FLICK_PX_PER_MS = 0.35;
const VELOCITY_WINDOW_MS = 100;
const SETTLE_MIN_MS = 150;
const SETTLE_MAX_MS = 300;
/** The page's own transition when the state switches without a drag. */
const CLASS_SLIDE_MS = 300;
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
  page: HTMLElement | null;
  progress: number;
  dragging: boolean;
  samples: Sample[];
};

export interface DrawerSwipeElements {
  drawer: HTMLElement;
  scrim: HTMLElement;
  /** The strip along the left edge; absent when the host keeps that edge. */
  edge: HTMLElement | null;
  /**
   * The page beside the drawer, which the open drawer pushes aside by its
   * width. Looked up when a drag starts: the page can go away while the
   * drawer stays (the chat's error screen takes its place).
   */
  page: () => HTMLElement | null;
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
 * Touch drags move the drawer and the page it pushes aside with the finger:
 * in from the edge strip, out from the drawer or the scrim over the page. On
 * release they settle open or closed by distance and speed. Mouse input never
 * starts one.
 *
 * Listeners sit only on these elements, not on the document, so touches
 * elsewhere keep the browser's fast scrolling path.
 */
export function attachDrawerSwipe(
  { drawer, scrim, edge, page }: DrawerSwipeElements,
  host: DrawerSwipeHost,
): DrawerSwipe {
  let gesture: Gesture | null = null;
  // A drag that ends on the other side slides the drawer with inline styles
  // and switches the page's state a little later. The inline styles stay
  // until both the slide and the switch are done: the stylesheet's transform
  // is written differently, and handing over mid-slide would restart it.
  let sliding = false;
  let waitingForPage = false;
  let slideTarget: boolean | null = null;
  let switchFrame: number | undefined;
  let pendingSwitch: (() => void) | null = null;
  let settleTimer: number | undefined;
  let movedPage: HTMLElement | null = null;

  const clearPosition = () => {
    drawer.style.transform = "";
    drawer.style.opacity = "";
    drawer.style.pointerEvents = "";
    scrim.style.transform = "";
    scrim.style.opacity = "";
    scrim.style.pointerEvents = "";
    if (movedPage) {
      movedPage.style.transform = "";
    }
  };
  const releasePage = () => {
    delete scrim.dataset.sidebarMoving;
    if (movedPage) {
      movedPage.style.transform = "";
      movedPage.style.transition = "";
      // Kept until here so the page keeps its pushed shape while it slides.
      delete movedPage.dataset.sidebarMoving;
      movedPage = null;
    }
  };
  const clearTransition = () => {
    drawer.style.transition = "";
    scrim.style.transition = "";
    releasePage();
  };
  const tidy = () => {
    if (!sliding && !waitingForPage && !pendingSwitch) {
      slideTarget = null;
      clearPosition();
      clearTransition();
    }
  };
  const cancelSwitch = () => {
    window.cancelAnimationFrame(switchFrame ?? 0);
    switchFrame = undefined;
    if (pendingSwitch) {
      document.removeEventListener("touchstart", pendingSwitch, true);
      pendingSwitch = null;
    }
  };

  const place = (progress: number, width: number) => {
    // eslint-disable-next-line lingui/no-unlocalized-strings -- CSS value
    drawer.style.transform = `translateX(${(progress - 1) * width}px)`;
    // eslint-disable-next-line lingui/no-unlocalized-strings -- CSS value
    const pushed = `translateX(${progress * width}px)`;
    scrim.style.transform = pushed;
    scrim.style.opacity = String(progress);
    if (movedPage) {
      movedPage.style.transform = pushed;
    }
  };

  const reduceMotion = () =>
    typeof window.matchMedia === "function" &&
    window.matchMedia(REDUCED_MOTION_QUERY).matches;

  // Closed without a drag (the button, a tap on the page, Escape, a pick):
  // the stylesheet slides the page back, and without the marker its corners
  // would go square as the slide starts.
  const holdShapeWhileClosing = () => {
    const target = page();
    if (!target || reduceMotion()) {
      return;
    }
    if (movedPage !== target) {
      releasePage();
      movedPage = target;
    }
    target.dataset.sidebarMoving = "";
    scrim.dataset.sidebarMoving = "";
    sliding = true;
    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(() => {
      sliding = false;
      tidy();
    }, CLASS_SLIDE_MS + 50);
  };

  const settle = (open: boolean, ended: Gesture) => {
    const remaining = Math.abs((open ? 1 : 0) - ended.progress);
    const ms = reduceMotion()
      ? 0
      : Math.round(SETTLE_MIN_MS + (SETTLE_MAX_MS - SETTLE_MIN_MS) * remaining);

    const slide = `transform ${ms}ms ${SETTLE_EASING}`;

    const fade = `opacity ${ms}ms ${SETTLE_EASING}`;
    drawer.style.transition = `${slide}, ${fade}`;
    scrim.style.transition = `${slide}, ${fade}`;
    if (movedPage) {
      movedPage.style.transition = slide;
    }
    cancelSwitch();
    waitingForPage = false;
    slideTarget = null;
    sliding = true;
    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(() => {
      sliding = false;
      tidy();
    }, ms + 50);

    if (open === host.isOpen()) {
      clearPosition();
      return;
    }
    // The slide starts now. The page's switch costs a frame or two of work,
    // and doing it here would hold the slide's first frame back.
    place(open ? 1 : 0, ended.width);
    drawer.style.opacity = open ? "1" : "0";
    const pointerEvents = open ? "auto" : "none";
    drawer.style.pointerEvents = pointerEvents;
    scrim.style.pointerEvents = pointerEvents;
    waitingForPage = true;
    slideTarget = open;
    const switchNow = () => {
      cancelSwitch();
      if (open === host.isOpen()) {
        waitingForPage = false;
        tidy();
      } else if (open) {
        host.onOpen();
      } else {
        host.onClose();
      }
    };
    pendingSwitch = switchNow;
    // A touch meanwhile meets the page already switched.
    document.addEventListener("touchstart", switchNow, {
      capture: true,
      passive: true,
    });
    // A callback of one frame request runs in the frame that starts the
    // slide, before it is drawn; the second runs once it is on screen.
    switchFrame = window.requestAnimationFrame(() => {
      switchFrame = window.requestAnimationFrame(switchNow);
    });
  };

  const start = (opensFromHere: boolean) => (event: TouchEvent) => {
    if (event.touches.length !== 1) {
      if (gesture?.dragging) {
        settle(gesture.startProgress === 1, gesture);
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
      page: page(),
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
      sliding = false;
      slideTarget = null;
      if (movedPage !== gesture.page) {
        releasePage();
        movedPage = gesture.page;
      }
      drawer.style.transition = "none";
      drawer.style.opacity = "1";
      scrim.style.transition = "none";
      scrim.dataset.sidebarMoving = "";
      if (movedPage) {
        movedPage.style.transition = "none";
        movedPage.dataset.sidebarMoving = "";
      }
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
      settle(ended.startProgress === 1, ended);
      return;
    }
    // No click on the row or the scrim under the lifted finger.
    event.preventDefault();
    // The lift counts: a finger that stopped before it is not a flick.
    const lift = event.changedTouches.item(0);
    if (lift) {
      ended.samples.push({ x: lift.clientX, t: event.timeStamp });
    }
    settle(settlesOpen(ended.progress, releaseVelocity(ended.samples)), ended);
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
      if (slideTarget !== null && host.isOpen() !== slideTarget) {
        // Turned back during the slide (the button, the scrim): the page's
        // own transition carries on from where the drawer is.
        cancelSwitch();
        window.clearTimeout(settleTimer);
        sliding = false;
        waitingForPage = false;
        tidy();
        if (!host.isOpen()) {
          holdShapeWhileClosing();
        }
        return;
      }
      if (waitingForPage) {
        waitingForPage = false;
        tidy();
      } else if (!host.isOpen()) {
        holdShapeWhileClosing();
      }
    },
    detach: () => {
      removers.forEach((remove) => remove());
      cancelSwitch();
      window.clearTimeout(settleTimer);
      clearPosition();
      clearTransition();
    },
  };
}

interface SidebarDrawerSwipeOptions {
  /** A narrow screen, where the open sidebar pushes the page aside. */
  enabled: boolean;
  isOpen: boolean;
  drawerRef: RefObject<HTMLElement | null>;
  scrimRef: RefObject<HTMLElement | null>;
  edgeRef: RefObject<HTMLElement | null>;
  pageRef: RefObject<HTMLElement | null> | undefined;
  onOpen: () => void;
  onClose: () => void;
}

export function useSidebarDrawerSwipe({
  enabled,
  isOpen,
  drawerRef,
  scrimRef,
  edgeRef,
  pageRef,
  onOpen,
  onClose,
}: SidebarDrawerSwipeOptions) {
  const latest = useRef({ isOpen, pageRef, onOpen, onClose });
  latest.current = { isOpen, pageRef, onOpen, onClose };
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
      {
        drawer,
        scrim,
        edge: edgeRef.current,
        page: () => latest.current.pageRef?.current ?? null,
      },
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
