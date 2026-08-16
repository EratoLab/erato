/**
 * UI State Store
 *
 * Manages UI-related state like sidebar visibility, modals, and UI preferences.
 * This is separate from API/data state which is handled by React Query.
 */
/* eslint-disable lingui/no-unlocalized-strings */
import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";

export interface UIState {
  /**
   * Whether the sidebar is currently open
   */
  isSidebarOpen: boolean;

  /**
   * User-dragged width of the expanded sidebar in px; null means the theme's
   * own width. Clamped against the active theme's [width, 2×width] when
   * applied, since the theme may have changed between sessions.
   */
  sidebarWidth: number | null;

  /**
   * Toggle the sidebar open/closed state
   */
  toggleSidebar: () => void;

  /**
   * Set the sidebar open/closed state explicitly
   */
  setSidebarOpen: (isOpen: boolean) => void;

  /**
   * Set the expanded sidebar width in px, or null to restore the theme width
   */
  setSidebarWidth: (width: number | null) => void;
}

/**
 * UI state store using Zustand
 * Handles UI-specific state like sidebar visibility
 */
export const useUIStore = create<UIState>()(
  devtools(
    persist(
      (set) => ({
        isSidebarOpen: true,
        sidebarWidth: null,

        toggleSidebar: () =>
          set(
            (state) => ({
              isSidebarOpen: !state.isSidebarOpen,
            }),
            false,
            "ui/toggleSidebar",
          ),

        setSidebarOpen: (isOpen: boolean) =>
          set(
            {
              isSidebarOpen: isOpen,
            },
            false,
            "ui/setSidebarOpen",
          ),

        setSidebarWidth: (width: number | null) =>
          set(
            {
              sidebarWidth: width,
            },
            false,
            "ui/setSidebarWidth",
          ),
      }),
      {
        name: "ui-store",
        partialize: (state) => ({
          isSidebarOpen: state.isSidebarOpen,
          sidebarWidth: state.sidebarWidth,
        }),
      },
    ),
    {
      name: "UI Store",
      store: "ui-store",
      enabled: process.env.NODE_ENV === "development",
    },
  ),
);
