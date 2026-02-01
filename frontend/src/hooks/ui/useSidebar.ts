/**
 * Custom hook for sidebar management
 *
 * Provides a clean interface for components to interact with the sidebar state
 * without directly accessing the Zustand store implementation.
 */
import { useEffect, useState } from "react";

import { useUIStore } from "../../state/uiStore";

export function useSidebar() {
  const { isSidebarOpen, toggleSidebar, setSidebarOpen } = useUIStore();

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
  };
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
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    // Tailwind's sm: breakpoint is 640px
    const mediaQuery = window.matchMedia("(min-width: 640px)");

    // Initial check
    setIsMobile(!mediaQuery.matches);

    // Listen for changes
    const handleChange = (e: MediaQueryListEvent) => {
      setIsMobile(!e.matches);
    };

    mediaQuery.addEventListener("change", handleChange);

    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, []);

  // On mobile, always use hidden mode regardless of configuration
  if (isMobile && configuredMode === "slim") {
    return "hidden";
  }

  return configuredMode;
}
