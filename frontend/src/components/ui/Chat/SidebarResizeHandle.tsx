"use client";

import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useRef, useState } from "react";

import { useTheme } from "@/components/providers/ThemeProvider";
import { useUIStore } from "@/state/uiStore";

/**
 * The user-dragged width lives in its own variable rather than in
 * --theme-layout-sidebar-width: the theme pipeline owns that name and clears
 * root inline values for every theme variable when it (re)applies. Consumers
 * read var(--sidebar-width-override, var(--theme-layout-sidebar-width)).
 */
const SIDEBAR_WIDTH_OVERRIDE_VAR = "--sidebar-width-override";
const THEME_SIDEBAR_WIDTH_VAR = "--theme-layout-sidebar-width";
/** The sidebar can grow to at most this multiple of the theme's own width. */
const MAX_WIDTH_FACTOR = 2;
const KEYBOARD_STEP_PX = 16;
/** Fallback when a theme ships an unparseable width (probe measures 0). */
const FALLBACK_MIN_WIDTH_PX = 280;
/** Pointer travel below this is a click, not a resize drag. */
const DRAG_SLOP_PX = 4;

const clampWidth = (width: number, min: number) =>
  Math.min(Math.max(width, min), min * MAX_WIDTH_FACTOR);

/**
 * The theme's own sidebar width in px. Custom properties don't compute to
 * px, so a probe element resolves the length.
 */
const measureThemeSidebarWidth = (): number => {
  const probe = document.createElement("div");
  probe.style.cssText = `position:absolute;visibility:hidden;width:var(${THEME_SIDEBAR_WIDTH_VAR})`;
  document.body.appendChild(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  return Number.isFinite(width) && width > 0 ? width : FALLBACK_MIN_WIDTH_PX;
};

/**
 * A persisted width can exceed a small viewport (it is clamped against the
 * theme width, which itself may be wider than the window), so the override
 * never renders past the viewport edge.
 */
const setOverride = (width: number) => {
  document.documentElement.style.setProperty(
    SIDEBAR_WIDTH_OVERRIDE_VAR,
    // eslint-disable-next-line lingui/no-unlocalized-strings -- CSS length
    `min(${width}px, 100vw)`,
  );
};

const removeOverride = () => {
  document.documentElement.style.removeProperty(SIDEBAR_WIDTH_OVERRIDE_VAR);
};

/** Re-derive the override from the persisted width (or clear it). */
const syncOverrideFromStore = (sidebarWidth: number | null) => {
  if (sidebarWidth == null) {
    removeOverride();
    return;
  }
  setOverride(clampWidth(sidebarWidth, measureThemeSidebarWidth()));
};

/**
 * Applies the persisted sidebar width as the root-level override variable,
 * clamped against the active theme's own width. Mount this once from the
 * sidebar shell.
 */
export const useApplySidebarWidth = () => {
  const sidebarWidth = useUIStore((state) => state.sidebarWidth);
  // The customer theme (and its sidebar width) lands asynchronously after
  // mount; re-clamping on theme identity keeps the override from staying
  // pinned to the built-in width's bounds.
  const { effectiveTheme, customThemeName } = useTheme();

  // No unmount cleanup: the override is app-global state, and sidebar
  // instances can overlap during route transitions — a departing instance's
  // cleanup would wipe the value the arriving instance just applied.
  useEffect(() => {
    syncOverrideFromStore(sidebarWidth);
  }, [sidebarWidth, effectiveTheme, customThemeName]);
};

interface DragState {
  pointerId: number;
  startX: number;
  startWidth: number;
  min: number;
  moved: boolean;
}

/**
 * Invisible drag strip on the expanded sidebar's right edge. Writes the width
 * token directly while dragging (transitions are suppressed via the root
 * data-sidebar-resizing attribute) and persists the result on release.
 */
export const SidebarResizeHandle = () => {
  const setSidebarWidth = useUIStore((state) => state.setSidebarWidth);
  const dragState = useRef<DragState | null>(null);
  const lastDragMovedRef = useRef(false);
  const [range, setRange] = useState<{
    min: number;
    max: number;
    now: number;
  } | null>(null);

  const measureCurrentWidth = useCallback((handle: HTMLElement): number => {
    const aside = handle.closest('[data-ui="sidebar"]');
    return aside
      ? aside.getBoundingClientRect().width
      : measureThemeSidebarWidth();
  }, []);

  // aria values derive from the persisted target, not the DOM: the width
  // animates 300ms, so DOM reads would announce the previous width (or a
  // mid-transition one) to screen readers.
  const refreshRange = useCallback(() => {
    const min = measureThemeSidebarWidth();
    const stored = useUIStore.getState().sidebarWidth;
    setRange({
      min: Math.round(min),
      max: Math.round(min * MAX_WIDTH_FACTOR),
      now: Math.round(clampWidth(stored ?? min, min)),
    });
  }, []);

  useEffect(() => {
    refreshRange();
  }, [refreshRange]);

  // The handle can unmount mid-drag (collapse via keyboard or a second touch
  // pointer); without this cleanup the root attribute — and with it the
  // app-wide transition/cursor/selection suppression — would stay stuck until
  // some later drag completes.
  useEffect(
    () => () => {
      if (!dragState.current) return;
      dragState.current = null;
      document.documentElement.removeAttribute("data-sidebar-resizing");
      syncOverrideFromStore(useUIStore.getState().sidebarWidth);
    },
    [],
  );

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragState.current;
      if (drag?.pointerId !== e.pointerId) return;
      dragState.current = null;
      document.documentElement.removeAttribute("data-sidebar-resizing");
      // The release position is authoritative: intermediate pointermoves may
      // be coalesced away, but the up event always carries the final point.
      // pointercancel carries no usable position, so it keeps the width the
      // last processed move applied.
      const width =
        e.type === "pointercancel"
          ? clampWidth(measureCurrentWidth(e.currentTarget), drag.min)
          : clampWidth(drag.startWidth + (e.clientX - drag.startX), drag.min);
      lastDragMovedRef.current =
        drag.moved || Math.abs(e.clientX - drag.startX) > DRAG_SLOP_PX;
      // Back at the theme's own width means "no override".
      if (width > drag.min) {
        setOverride(width);
        setSidebarWidth(Math.round(width));
      } else {
        removeOverride();
        setSidebarWidth(null);
      }
      refreshRange();
      // Last: a throwing release must not skip the cleanup above.
      try {
        e.currentTarget.releasePointerCapture(drag.pointerId);
      } catch {
        // Inactive pointer — capture is already gone.
      }
    },
    [measureCurrentWidth, refreshRange, setSidebarWidth],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (dragState.current) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      // Suppress the native drag/selection gesture, which would otherwise
      // fire pointercancel mid-drag and drop the capture.
      e.preventDefault();
      dragState.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startWidth: measureCurrentWidth(e.currentTarget),
        min: measureThemeSidebarWidth(),
        moved: false,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      document.documentElement.setAttribute("data-sidebar-resizing", "");
    },
    [measureCurrentWidth],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragState.current;
      if (drag?.pointerId !== e.pointerId) return;
      if (Math.abs(e.clientX - drag.startX) > DRAG_SLOP_PX) {
        drag.moved = true;
      }
      setOverride(
        clampWidth(drag.startWidth + (e.clientX - drag.startX), drag.min),
      );
    },
    [],
  );

  const handleDoubleClick = useCallback(() => {
    // A double-press whose presses actually dragged is two resize gestures,
    // not a reset request — resetting would discard the width just set.
    if (lastDragMovedRef.current) {
      lastDragMovedRef.current = false;
      return;
    }
    setSidebarWidth(null);
    removeOverride();
    refreshRange();
  }, [refreshRange, setSidebarWidth]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const min = measureThemeSidebarWidth();
      // The stored width is the base, not the DOM width: the width change
      // animates, so mid-transition DOM reads would make repeated key
      // presses compound incorrectly.
      const current = clampWidth(
        useUIStore.getState().sidebarWidth ?? min,
        min,
      );
      let next: number | null;
      switch (e.key) {
        case "ArrowRight":
          next = clampWidth(current + KEYBOARD_STEP_PX, min);
          break;
        case "ArrowLeft":
          next = clampWidth(current - KEYBOARD_STEP_PX, min);
          break;
        case "Home":
          next = min;
          break;
        case "End":
          next = min * MAX_WIDTH_FACTOR;
          break;
        default:
          return;
      }
      e.preventDefault();
      setSidebarWidth(next > min ? Math.round(next) : null);
      refreshRange();
    },
    [refreshRange, setSidebarWidth],
  );

  /* eslint-disable jsx-a11y/no-noninteractive-element-interactions,
     jsx-a11y/no-noninteractive-tabindex -- ARIA window-splitter pattern: a
     focusable separator driven by pointer drags and arrow keys, which
     jsx-a11y cannot infer from the role. */
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={t`Resize sidebar`}
      aria-valuemin={range?.min}
      aria-valuemax={range?.max}
      aria-valuenow={range?.now}
      data-ui="sidebar-resize-handle"
      className="sidebar-resize-handle focus-ring-inset absolute inset-y-0 right-0 z-10 hidden w-1.5 touch-none hover:bg-[var(--theme-border-divider)] sm:block"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
    />
  );
  /* eslint-enable jsx-a11y/no-noninteractive-element-interactions,
     jsx-a11y/no-noninteractive-tabindex */
};
