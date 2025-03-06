"use client";

import React, { createContext, useContext, useEffect, useState } from "react";

import { defaultTheme, darkTheme } from "@/config/theme";

import type { Theme } from "@/config/theme";

export type ThemeMode = "light" | "dark";

type ThemeContextType = {
  theme: Theme;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// Try to get the saved theme from localStorage
const getSavedTheme = (): ThemeMode => {
  if (typeof window === "undefined") return "light";

  const savedTheme = localStorage.getItem("theme-mode");
  if (savedTheme === "dark" || savedTheme === "light") {
    return savedTheme;
  }

  // Check system preference if no saved theme
  if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }

  return "light";
};

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const [theme, setTheme] = useState<Theme>(defaultTheme);

  // Initialize theme from saved settings
  useEffect(() => {
    const savedMode = getSavedTheme();
    setThemeMode(savedMode);
  }, []);

  // Update theme when themeMode changes
  useEffect(() => {
    setTheme(themeMode === "dark" ? darkTheme : defaultTheme);

    // Save to localStorage
    if (typeof window !== "undefined") {
      localStorage.setItem("theme-mode", themeMode);

      // Update data-theme attribute on document for potential CSS selectors
      document.documentElement.setAttribute("data-theme", themeMode);
    }
  }, [themeMode]);

  useEffect(() => {
    // Apply theme CSS variables
    const root = document.documentElement;

    // Background colors
    root.style.setProperty(
      "--theme-bg-primary",
      theme.colors.background.primary,
    );
    root.style.setProperty(
      "--theme-bg-secondary",
      theme.colors.background.secondary,
    );
    root.style.setProperty(
      "--theme-bg-tertiary",
      theme.colors.background.tertiary,
    );
    root.style.setProperty(
      "--theme-bg-sidebar",
      theme.colors.background.sidebar,
    );
    root.style.setProperty("--theme-bg-accent", theme.colors.background.accent);
    root.style.setProperty("--theme-bg-hover", theme.colors.background.hover);
    root.style.setProperty(
      "--theme-bg-selected",
      theme.colors.background.selected,
    );

    // Foreground colors
    root.style.setProperty(
      "--theme-fg-primary",
      theme.colors.foreground.primary,
    );
    root.style.setProperty(
      "--theme-fg-secondary",
      theme.colors.foreground.secondary,
    );
    root.style.setProperty("--theme-fg-muted", theme.colors.foreground.muted);
    root.style.setProperty("--theme-fg-accent", theme.colors.foreground.accent);

    // Border colors
    root.style.setProperty("--theme-border", theme.colors.border.default);
    root.style.setProperty("--theme-border-strong", theme.colors.border.strong);
    root.style.setProperty("--theme-border-focus", theme.colors.border.focus);

    // Avatar colors
    root.style.setProperty(
      "--theme-avatar-user-bg",
      theme.colors.avatar.user.background,
    );
    root.style.setProperty(
      "--theme-avatar-user-fg",
      theme.colors.avatar.user.foreground,
    );
    root.style.setProperty(
      "--theme-avatar-assistant-bg",
      theme.colors.avatar.assistant.background,
    );
    root.style.setProperty(
      "--theme-avatar-assistant-fg",
      theme.colors.avatar.assistant.foreground,
    );

    // Status colors
    // Info
    root.style.setProperty(
      "--theme-info-fg",
      theme.colors.status.info.foreground,
    );
    root.style.setProperty(
      "--theme-info-bg",
      theme.colors.status.info.background,
    );
    root.style.setProperty(
      "--theme-info-border",
      theme.colors.status.info.border,
    );

    // Success
    root.style.setProperty(
      "--theme-success-fg",
      theme.colors.status.success.foreground,
    );
    root.style.setProperty(
      "--theme-success-bg",
      theme.colors.status.success.background,
    );
    root.style.setProperty(
      "--theme-success-border",
      theme.colors.status.success.border,
    );

    // Warning
    root.style.setProperty(
      "--theme-warning-fg",
      theme.colors.status.warning.foreground,
    );
    root.style.setProperty(
      "--theme-warning-bg",
      theme.colors.status.warning.background,
    );
    root.style.setProperty(
      "--theme-warning-border",
      theme.colors.status.warning.border,
    );

    // Error
    root.style.setProperty(
      "--theme-error-fg",
      theme.colors.status.error.foreground,
    );
    root.style.setProperty(
      "--theme-error-bg",
      theme.colors.status.error.background,
    );
    root.style.setProperty(
      "--theme-error-border",
      theme.colors.status.error.border,
    );

    // Focus ring
    root.style.setProperty("--theme-focus-ring", theme.colors.focus.ring);
  }, [theme]);

  const toggleTheme = (mode: ThemeMode) => {
    setThemeMode(mode);
  };

  return (
    <ThemeContext.Provider
      value={{
        theme,
        themeMode,
        setThemeMode: toggleTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
