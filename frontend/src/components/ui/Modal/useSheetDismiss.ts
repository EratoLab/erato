import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

import type { RefObject } from "react";

/** Movement before a touch counts as a drag, and which way. */
const SLOP_PX = 6;
/** A release faster than this goes the way the finger went, however far. */
const FLICK_PX_PER_MS = 0.5;
const VELOCITY_WINDOW_MS = 100;
/** Let go past this share of its height, a sheet closes. */
const CLOSE_FRACTION = 0.3;
/** The grabber alone is too small to hit, so the band reaches this far down. */
const MIN_BAND_PX = 44;
const SLIDE_OUT_MS = 220;
const SETTLE_MS = 200;
// eslint-disable-next-line lingui/no-unlocalized-strings -- CSS value
const SETTLE_EASING = "cubic-bezier(0.2, 0.8, 0.2, 1)";
// eslint-disable-next-line lingui/no-unlocalized-strings -- CSS value
const SLIDE_OUT_EASING = "cubic-bezier(0.4, 0, 1, 1)";
// eslint-disable-next-line lingui/no-unlocalized-strings -- media query
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** `offset` and `velocity` (px/ms) are positive downwards. */
export function sheetSettlesClosed(
  offset: number,
  height: number,
  velocity: number,
): boolean {
  if (velocity > FLICK_PX_PER_MS) {
    return true;
  }
  if (velocity < -FLICK_PX_PER_MS) {
    return false;
  }
  return offset > height * CLOSE_FRACTION;
}

type Sample = { y: number; t: number };

function releaseVelocity(samples: Sample[]): number {
  const last = samples.at(-1);
  if (!last) {
    return 0;
  }
  const first =
    samples.find((sample) => last.t - sample.t <= VELOCITY_WINDOW_MS) ?? last;
  const dt = last.t - first.t;
  return dt > 0 ? (last.y - first.y) / dt : 0;
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia(REDUCED_MOTION_QUERY).matches;

type Gesture = {
  startX: number;
  startY: number;
  height: number;
  dragging: boolean;
  offset: number;
  samples: Sample[];
};

interface UseSheetDismissOptions {
  /** The dialog is a sheet: it follows a drag down and slides out to close. */
  enabled: boolean;
  shellRef: RefObject<HTMLElement | null>;
  /** The header; a drag may start on it or above it, never in the content. */
  bandRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}

/**
 * Swipe a sheet down to close it, from its grabber or header only, so the
 * content scrolls as usual. `dismiss` is how the sheet's own controls close
 * it: it slides out first, unless motion is reduced.
 */
export function useSheetDismiss({
  enabled,
  shellRef,
  bandRef,
  onClose,
}: UseSheetDismissOptions): { dismiss: () => void } {
  // Callers pass inline closures; the listeners below must not re-bind on
  // every render while a finger is down.
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });
  const closingRef = useRef(false);
  const timersRef = useRef<number[]>([]);

  const later = useCallback((ms: number, run: () => void) => {
    timersRef.current.push(window.setTimeout(run, ms));
  }, []);

  useEffect(
    () => () => {
      timersRef.current.forEach((timer) => window.clearTimeout(timer));
      timersRef.current = [];
      closingRef.current = false;
    },
    [],
  );

  const settleBack = useCallback(
    (shell: HTMLElement) => {
      if (prefersReducedMotion()) {
        shell.style.removeProperty("transition");
        shell.style.removeProperty("transform");
        return;
      }
      shell.style.transition = `transform ${SETTLE_MS}ms ${SETTLE_EASING}`;
      shell.style.removeProperty("transform");
      later(SETTLE_MS, () => shell.style.removeProperty("transition"));
    },
    [later],
  );

  const close = useCallback(
    (shell: HTMLElement | null) => {
      const finish = () => {
        closingRef.current = false;
        onCloseRef.current();
        // A caller may keep the dialog open (a save in progress); the sheet
        // must not stay parked below the screen then.
        later(SETTLE_MS, () => {
          if (shell?.isConnected) {
            settleBack(shell);
          }
        });
      };
      if (!shell || prefersReducedMotion()) {
        finish();
        return;
      }
      closingRef.current = true;
      shell.style.transition = `transform ${SLIDE_OUT_MS}ms ${SLIDE_OUT_EASING}`;
      // eslint-disable-next-line lingui/no-unlocalized-strings -- CSS value
      shell.style.transform = "translateY(100%)";
      later(SLIDE_OUT_MS, finish);
    },
    [later, settleBack],
  );

  const dismiss = useCallback(() => {
    if (closingRef.current) {
      return;
    }
    if (!enabled) {
      onCloseRef.current();
      return;
    }
    close(shellRef.current);
  }, [close, enabled, shellRef]);

  useEffect(() => {
    const shell = shellRef.current;
    if (!enabled || !shell) {
      return;
    }
    let gesture: Gesture | null = null;

    const onStart = (event: TouchEvent) => {
      gesture = null;
      if (closingRef.current || event.touches.length !== 1) {
        return;
      }
      const touch = event.touches[0];
      const top = shell.getBoundingClientRect().top;
      const bandBottom = Math.max(
        bandRef.current?.getBoundingClientRect().bottom ?? top,
        top + MIN_BAND_PX,
      );
      if (touch.clientY > bandBottom) {
        return;
      }
      gesture = {
        startX: touch.clientX,
        startY: touch.clientY,
        height: shell.getBoundingClientRect().height,
        dragging: false,
        offset: 0,
        samples: [{ y: touch.clientY, t: event.timeStamp }],
      };
    };

    const onMove = (event: TouchEvent) => {
      if (!gesture || event.touches.length !== 1) {
        return;
      }
      const touch = event.touches[0];
      const dx = touch.clientX - gesture.startX;
      const dy = touch.clientY - gesture.startY;
      if (!gesture.dragging) {
        if (Math.hypot(dx, dy) < SLOP_PX) {
          return;
        }
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) {
          gesture = null;
          return;
        }
        gesture.dragging = true;
        // The skin's colour transition also lists transform, which would
        // make the sheet trail the finger.
        shell.style.transition = "none";
      }
      // Keeps the page and Safari's own pull-down from moving under it.
      event.preventDefault();
      gesture.offset = Math.max(0, dy);
      // eslint-disable-next-line lingui/no-unlocalized-strings -- CSS value
      shell.style.transform = `translateY(${gesture.offset}px)`;
      gesture.samples.push({ y: touch.clientY, t: event.timeStamp });
      if (gesture.samples.length > 12) {
        gesture.samples.shift();
      }
    };

    const onEnd = (event: TouchEvent) => {
      const ended = gesture;
      gesture = null;
      if (!ended?.dragging) {
        return;
      }
      // No click after a drag that started on the close button.
      if (event.cancelable) {
        event.preventDefault();
      }
      // A finger held still before lifting has no speed left.
      const lifted = event.changedTouches[0] as Touch | undefined;
      if (lifted) {
        ended.samples.push({ y: lifted.clientY, t: event.timeStamp });
      }
      if (
        event.type === "touchend" &&
        sheetSettlesClosed(
          ended.offset,
          ended.height,
          releaseVelocity(ended.samples),
        )
      ) {
        close(shell);
      } else {
        settleBack(shell);
      }
    };

    const active = { passive: false } as const;
    shell.addEventListener("touchstart", onStart, { passive: true });
    shell.addEventListener("touchmove", onMove, active);
    shell.addEventListener("touchend", onEnd, active);
    shell.addEventListener("touchcancel", onEnd);
    return () => {
      shell.removeEventListener("touchstart", onStart);
      shell.removeEventListener("touchmove", onMove);
      shell.removeEventListener("touchend", onEnd);
      shell.removeEventListener("touchcancel", onEnd);
      shell.style.removeProperty("transition");
      shell.style.removeProperty("transform");
    };
  }, [bandRef, close, enabled, settleBack, shellRef]);

  return { dismiss };
}
