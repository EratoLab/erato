"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";

import { useResponsive } from "../hooks/useResponsive";

interface SidebarContextType {
  /**
   * Whether the sidebar is currently collapsed
   */
  collapsed: boolean;
  /**
   * Function to toggle the sidebar collapsed state
   */
  toggleCollapsed: () => void;
  /**
   * Function to explicitly set the sidebar state
   */
  setCollapsed: (value: boolean) => void;
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

interface SidebarProviderProps {
  children: React.ReactNode;
}

export const SidebarProvider: React.FC<SidebarProviderProps> = ({
  children,
}) => {
  const { isMobile } = useResponsive();

  // Set initial collapsed state based on screen size
  const [collapsed, setCollapsedState] = useState<boolean>(isMobile);

  // Effect to handle screen size changes - auto-collapse on mobile
  useEffect(() => {
    setCollapsedState(isMobile);
  }, [isMobile]);

  // Toggle function
  const toggleCollapsed = useCallback(() => {
    setCollapsedState((prev) => !prev);
  }, []);

  // Explicit set function
  const setCollapsed = useCallback((value: boolean) => {
    setCollapsedState(value);
  }, []);

  return (
    <SidebarContext.Provider
      value={{
        collapsed,
        toggleCollapsed,
        setCollapsed,
      }}
    >
      {children}
    </SidebarContext.Provider>
  );
};

/**
 * Hook to use the sidebar context
 * @throws Error if used outside of SidebarProvider
 */
export const useSidebar = (): SidebarContextType => {
  const context = useContext(SidebarContext);

  if (context === undefined) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }

  return context;
};
