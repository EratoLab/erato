/**
 * Custom hook for sidebar management
 *
 * Provides a clean interface for components to interact with the sidebar state
 * without directly accessing the Zustand store implementation.
 */
import { useSyncExternalStore } from "react";

import { useSidebarFeature } from "../../providers/FeatureConfigProvider";
import { useUIStore } from "../../state/uiStore";

export function useSidebar() {
  const { isSidebarOpen, toggleSidebar, setSidebarOpen } = useUIStore();
  const { collapsedMode } = useSidebarFeature();

  // Get responsive collapsed mode (forces hidden on mobile even if config is slim)
  const effectiveCollapsedMode = useResponsiveCollapsedMode(collapsedMode);

  return {
    /**
     * Current sidebar open state
     */
    isOpen: isSidebarOpen,

    /**
     * Toggle the sidebar between open and closed states
     */
    toggle: toggleSidebar,

    /**
     * Set the sidebar to a specific state
     */
    setOpen: setSidebarOpen,

    /**
     * Current effective collapsed mode (slim or hidden)
     * Takes into account screen size - forces hidden on mobile
     */
    collapsedMode: effectiveCollapsedMode,
  };
}

// Tailwind's sm: breakpoint.
// eslint-disable-next-line lingui/no-unlocalized-strings
const SIDEBAR_BESIDE_PAGE_QUERY = "(min-width: 640px)";

function subscribeToSidebarBreakpoint(onChange: () => void): () => void {
  const mediaQuery = window.matchMedia(SIDEBAR_BESIDE_PAGE_QUERY);
  mediaQuery.addEventListener("change", onChange);
  return () => mediaQuery.removeEventListener("change", onChange);
}

/**
 * Whether the screen is narrower than Tailwind's sm: breakpoint, where the
 * open sidebar is a drawer over the page instead of a column beside it.
 */
export function useIsNarrowScreen(): boolean {
  return useSyncExternalStore(
    subscribeToSidebarBreakpoint,
    () => !window.matchMedia(SIDEBAR_BESIDE_PAGE_QUERY).matches,
    () => false,
  );
}

/**
 * Hook to determine the effective collapsed mode based on screen size
 *
 * On mobile devices (below Tailwind's sm: breakpoint of 640px), this will
 * force "hidden" mode even if the configuration specifies "slim" mode,
 * as slim mode takes up too much horizontal space on small screens.
 *
 * @param configuredMode - The collapsed mode from configuration ("slim" | "hidden")
 * @returns The effective collapsed mode to use ("slim" | "hidden")
 */
export function useResponsiveCollapsedMode(
  configuredMode: "slim" | "hidden",
): "slim" | "hidden" {
  const isMobile = useIsNarrowScreen();

  // On mobile, always use hidden mode regardless of configuration
  if (isMobile && configuredMode === "slim") {
    return "hidden";
  }

  return configuredMode;
}
