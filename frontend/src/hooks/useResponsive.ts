"use client";

import { useState, useEffect } from "react";

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

export function useResponsive(): ResponsiveState {
  // Initialize with reasonable defaults to avoid hydration issues
  const [state, setState] = useState<ResponsiveState>({
    width: typeof window !== "undefined" ? window.innerWidth : 1024,
    height: typeof window !== "undefined" ? window.innerHeight : 768,
    isMobile: false,
    isTablet: false,
    isDesktop: true,
    breakpoint: null,
    isBelow: () => false,
    isAbove: () => true,
  });

  useEffect(() => {
    // Skip if window is not available (SSR)
    if (typeof window === "undefined") return;

    const calculateResponsiveState = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;

      // Determine current breakpoint
      let currentBreakpoint: Breakpoint | null = null;
      let prevBreakpointValue = 0;

      for (const [key, value] of Object.entries(breakpoints)) {
        if (width >= value && value > prevBreakpointValue) {
          currentBreakpoint = key as Breakpoint;
          prevBreakpointValue = value;
        }
      }

      const isMobile = width < breakpoints.md;
      const isTablet = width >= breakpoints.md && width < breakpoints.lg;
      const isDesktop = width >= breakpoints.lg;

      const isBelow = (breakpoint: Breakpoint) =>
        width < breakpoints[breakpoint];
      const isAbove = (breakpoint: Breakpoint) =>
        width >= breakpoints[breakpoint];

      setState({
        width,
        height,
        isMobile,
        isTablet,
        isDesktop,
        breakpoint: currentBreakpoint,
        isBelow,
        isAbove,
      });
    };

    // Calculate initial state
    calculateResponsiveState();

    // Set up event listener for window resize
    const handleResize = () => {
      calculateResponsiveState();
    };

    window.addEventListener("resize", handleResize);

    // Clean up event listener on component unmount
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return state;
}
