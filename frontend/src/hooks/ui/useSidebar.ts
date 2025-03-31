/**
 * Custom hook for sidebar management
 *
 * Provides a clean interface for components to interact with the sidebar state
 * without directly accessing the Zustand store implementation.
 */
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
