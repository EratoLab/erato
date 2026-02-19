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
   * Toggle the sidebar open/closed state
   */
  toggleSidebar: () => void;

  /**
   * Set the sidebar open/closed state explicitly
   */
  setSidebarOpen: (isOpen: boolean) => void;
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
      }),
      {
        name: "ui-store",
        partialize: (state) => ({ isSidebarOpen: state.isSidebarOpen }),
      },
    ),
    {
      name: "UI Store",
      store: "ui-store",
      enabled: process.env.NODE_ENV === "development",
    },
  ),
);
