/**
 * UI State Store
 *
 * Manages UI-related state like sidebar visibility, modals, and UI preferences.
 * This is separate from API/data state which is handled by React Query.
 */
import { create } from "zustand";

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
export const useUIStore = create<UIState>((set) => ({
  isSidebarOpen: true,

  toggleSidebar: () =>
    set((state) => ({
      isSidebarOpen: !state.isSidebarOpen,
    })),

  setSidebarOpen: (isOpen: boolean) =>
    set({
      isSidebarOpen: isOpen,
    }),
}));
