"use client";

import { useSyncExternalStore } from "react";

// Define breakpoints based on Tailwind's default breakpoints
export const breakpoints = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  "2xl": 1536,
};

export type Breakpoint = keyof typeof breakpoints;

export type ResponsiveState = {
  width: number;
  height: number;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  breakpoint: Breakpoint | null;
  isBelow: (breakpoint: Breakpoint) => boolean;
  isAbove: (breakpoint: Breakpoint) => boolean;
};

function computeState(width: number, height: number): ResponsiveState {
  let currentBreakpoint: Breakpoint | null = null;
  let prevBreakpointValue = 0;

  for (const [key, value] of Object.entries(breakpoints)) {
    if (width >= value && value > prevBreakpointValue) {
      currentBreakpoint = key as Breakpoint;
      prevBreakpointValue = value;
    }
  }

  return {
    width,
    height,
    isMobile: width < breakpoints.md,
    isTablet: width >= breakpoints.md && width < breakpoints.lg,
    isDesktop: width >= breakpoints.lg,
    breakpoint: currentBreakpoint,
    isBelow: (breakpoint: Breakpoint) => width < breakpoints[breakpoint],
    isAbove: (breakpoint: Breakpoint) => width >= breakpoints[breakpoint],
  };
}

// Stable fallback used before a window exists (and as the server snapshot).
const FALLBACK_STATE = computeState(1024, 768);

// useSyncExternalStore compares snapshots with Object.is and would loop forever
// if getSnapshot returned a fresh object every call, so cache the last computed
// state and only rebuild it when the viewport actually changes.
let cachedState: ResponsiveState = FALLBACK_STATE;

function getResponsiveSnapshot(): ResponsiveState {
  if (typeof window === "undefined") {
    return FALLBACK_STATE;
  }
  const width = window.innerWidth;
  const height = window.innerHeight;
  if (width !== cachedState.width || height !== cachedState.height) {
    cachedState = computeState(width, height);
  }
  return cachedState;
}

function getServerResponsiveSnapshot(): ResponsiveState {
  return FALLBACK_STATE;
}

function subscribeToResize(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }
  window.addEventListener("resize", onStoreChange);
  return () => window.removeEventListener("resize", onStoreChange);
}

/**
 * Viewport-derived responsive state. Backed by useSyncExternalStore so the
 * first committed render already reflects the real viewport (no desktop→mobile
 * flash) and reads stay tearing-free under concurrent rendering.
 */
export function useResponsive(): ResponsiveState {
  return useSyncExternalStore(
    subscribeToResize,
    getResponsiveSnapshot,
    getServerResponsiveSnapshot,
  );
}

// Matches Tailwind's `md` breakpoint exactly: `md:` applies at >=768px, so
// anything matching this query is the mobile (single-column) layout. The .98
// fractional bound keeps sub-pixel widths (e.g. 767.5) on the mobile side.
// eslint-disable-next-line lingui/no-unlocalized-strings -- CSS media query, not user-facing
const MOBILE_MEDIA_QUERY = "(max-width: 767.98px)";

function subscribeToMobile(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }
  const mql = window.matchMedia(MOBILE_MEDIA_QUERY);
  mql.addEventListener("change", onStoreChange);
  return () => mql.removeEventListener("change", onStoreChange);
}

function getMobileSnapshot(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

/**
 * Lean boolean selector for "is the viewport below the `md` breakpoint".
 * Prefer this over `useResponsive().isMobile` in components that only need the
 * flag: it re-renders only when the 768px boundary is crossed, not on every
 * resize pixel, and (like useResponsive) is first-paint-correct.
 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribeToMobile,
    getMobileSnapshot,
    () => false,
  );
}
