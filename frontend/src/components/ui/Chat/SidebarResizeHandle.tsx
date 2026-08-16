"use client";

import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useRef, useState } from "react";

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
  return width;
};

/**
 * Applies the persisted sidebar width as the root-level override variable,
 * clamped against the active theme's own width. Mount this once from the
 * sidebar shell.
 */
export const useApplySidebarWidth = () => {
  const sidebarWidth = useUIStore((state) => state.sidebarWidth);

  // No unmount cleanup: the override is app-global state, and sidebar
  // instances can overlap during route transitions — a departing instance's
  // cleanup would wipe the value the arriving instance just applied.
  useEffect(() => {
    const root = document.documentElement;
    if (sidebarWidth == null) {
      root.style.removeProperty(SIDEBAR_WIDTH_OVERRIDE_VAR);
      return;
    }
    const themeWidth = measureThemeSidebarWidth();
    const clamped = clampWidth(sidebarWidth, themeWidth);
    root.style.setProperty(SIDEBAR_WIDTH_OVERRIDE_VAR, `${clamped}px`);
  }, [sidebarWidth]);
};

interface DragState {
  pointerId: number;
  startX: number;
  startWidth: number;
  min: number;
}

/**
 * Invisible drag strip on the expanded sidebar's right edge. Writes the width
 * token directly while dragging (transitions are suppressed via the root
 * data-sidebar-resizing attribute) and persists the result on release.
 */
export const SidebarResizeHandle = () => {
  const sidebarWidth = useUIStore((state) => state.sidebarWidth);
  const setSidebarWidth = useUIStore((state) => state.setSidebarWidth);
  const dragState = useRef<DragState | null>(null);
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

  const refreshRange = useCallback(
    (handle: HTMLElement) => {
      const min = measureThemeSidebarWidth();
      setRange({
        min: Math.round(min),
        max: Math.round(min * MAX_WIDTH_FACTOR),
        now: Math.round(measureCurrentWidth(handle)),
      });
    },
    [measureCurrentWidth],
  );

  const handleRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (handleRef.current) {
      refreshRange(handleRef.current);
    }
  }, [refreshRange]);

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragState.current;
      if (drag?.pointerId !== e.pointerId) return;
      dragState.current = null;
      e.currentTarget.releasePointerCapture(drag.pointerId);
      document.documentElement.removeAttribute("data-sidebar-resizing");
      // The release position is authoritative: intermediate pointermoves may
      // be coalesced away, but the up event always carries the final point.
      // pointercancel carries no usable position, so it keeps the width the
      // last processed move applied.
      const width =
        e.type === "pointercancel"
          ? clampWidth(measureCurrentWidth(e.currentTarget), drag.min)
          : clampWidth(drag.startWidth + (e.clientX - drag.startX), drag.min);
      document.documentElement.style.setProperty(
        SIDEBAR_WIDTH_OVERRIDE_VAR,
        `${width}px`,
      );
      // Back at the theme's own width means "no override".
      setSidebarWidth(width > drag.min ? Math.round(width) : null);
      refreshRange(e.currentTarget);
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
      const width = clampWidth(
        drag.startWidth + (e.clientX - drag.startX),
        drag.min,
      );
      document.documentElement.style.setProperty(
        SIDEBAR_WIDTH_OVERRIDE_VAR,
        `${width}px`,
      );
    },
    [],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      setSidebarWidth(null);
      document.documentElement.style.removeProperty(SIDEBAR_WIDTH_OVERRIDE_VAR);
      refreshRange(e.currentTarget);
    },
    [refreshRange, setSidebarWidth],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const min = measureThemeSidebarWidth();
      // The stored width is the base, not the DOM width: the width change
      // animates, so mid-transition DOM reads would make repeated key
      // presses compound incorrectly.
      const current = clampWidth(sidebarWidth ?? min, min);
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
      refreshRange(e.currentTarget);
    },
    [refreshRange, setSidebarWidth, sidebarWidth],
  );

  /* eslint-disable jsx-a11y/no-noninteractive-element-interactions,
     jsx-a11y/no-noninteractive-tabindex -- ARIA window-splitter pattern: a
     focusable separator driven by pointer drags and arrow keys, which
     jsx-a11y cannot infer from the role. */
  return (
    <div
      ref={handleRef}
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
