/* eslint-disable lingui/no-unlocalized-strings */
"use client";

import { createContext, useContext, useEffect, useState } from "react";

import { ThemeApplier } from "@/components/ui/ThemeApplier";
import { defaultTheme, darkTheme } from "@/config/theme";
import {
  loadThemeConfig,
  defaultThemeConfig,
  resolveIconPaths,
} from "@/config/themeConfig";
import { deepMerge, type CustomThemeConfig } from "@/utils/themeUtils";

import type { Theme } from "@/config/theme";
import type { PropsWithChildren } from "react";

export type ThemeMode = "light" | "dark" | "system";

export const THEME_MODE_LOCAL_STORAGE_KEY = "theme-mode";

type ThemeContextType = {
  theme: Theme;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  isCustomTheme: boolean;
  customThemeName?: string;
  customThemeConfig?: CustomThemeConfig | null;
  effectiveTheme: "light" | "dark"; // The actual theme being applied (for UI indicators)
  iconMappings?: {
    fileTypes?: Record<string, string>;
    status?: Record<string, string>;
    actions?: Record<string, string>;
    navigation?: Record<string, string>;
  };
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// Try to get the saved theme from localStorage
const getSavedTheme = (): ThemeMode => {
  if (typeof window === "undefined") return "light";

  const savedTheme = localStorage.getItem(THEME_MODE_LOCAL_STORAGE_KEY);
  if (
    savedTheme === "dark" ||
    savedTheme === "light" ||
    savedTheme === "system"
  ) {
    return savedTheme as ThemeMode;
  }

  return "system"; // Default to system if nothing saved
};

// Get the effective theme based on the selected mode and system preference
const getEffectiveTheme = (mode: ThemeMode): "light" | "dark" => {
  if (mode === "light") return "light";
  if (mode === "dark") return "dark";

  // For system mode, check the system preference
  if (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  ) {
    return "dark";
  }
  return "light";
};

export function ThemeProvider({ children }: PropsWithChildren) {
  const savedOrDefaultThemeMode = getSavedTheme();
  const [themeMode, setThemeMode] = useState<ThemeMode>(
    savedOrDefaultThemeMode,
  );
  const [effectiveTheme, setEffectiveTheme] = useState<"light" | "dark">(
    getEffectiveTheme(savedOrDefaultThemeMode),
  );
  const [theme, setTheme] = useState<Theme>(defaultTheme);
  const [customThemeConfig, setCustomThemeConfig] =
    useState<CustomThemeConfig | null>(null);
  const [isCustomTheme, setIsCustomTheme] = useState(false);
  const [iconMappings, setIconMappings] = useState<{
    fileTypes?: Record<string, string>;
    status?: Record<string, string>;
    actions?: Record<string, string>;
    navigation?: Record<string, string>;
  }>();

  // Initialize theme from saved settings and try to load custom theme
  useEffect(() => {
    // Load theme using the configuration module
    const loadTheme = async () => {
      const themeConfig = await loadThemeConfig(defaultThemeConfig);
      if (themeConfig) {
        setCustomThemeConfig(themeConfig);
        setIsCustomTheme(true);

        // Resolve icon paths from theme config
        // Use undefined to let it fall back to env().themeCustomerName (e.g., "trilux-test")
        // instead of themeConfig.name (e.g., "Trilux Theme") which is the display name
        const resolvedIcons = resolveIconPaths(themeConfig.icons, undefined);
        setIconMappings(resolvedIcons);
      }
    };

    void loadTheme();
  }, []);

  // Load custom fonts.css when a custom theme is active
  useEffect(() => {
    if (!customThemeConfig) return;

    // Get fonts.css path using theme configuration
    const fontsCssPath = defaultThemeConfig.getFontsCssPath(
      customThemeConfig.name,
    );

    // If no path returned, don't load fonts
    if (!fontsCssPath) return;

    // Check if fonts.css link already exists
    const existingLink = document.querySelector(
      'link[data-theme-fonts="true"]',
    );

    // If it exists with the same href, do nothing
    if (existingLink && existingLink.getAttribute("href") === fontsCssPath) {
      return;
    }

    // Remove old link if it exists
    if (existingLink) {
      existingLink.remove();
    }

    // Create and append new link element
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = fontsCssPath;
    link.setAttribute("data-theme-fonts", "true");

    // Add to head
    document.head.appendChild(link);

    // Cleanup function to remove the link when component unmounts or theme changes
    return () => {
      const linkToRemove = document.querySelector(
        'link[data-theme-fonts="true"]',
      );
      if (linkToRemove) {
        linkToRemove.remove();
      }
    };
  }, [customThemeConfig]);

  // Listen for system preference changes when in system mode
  useEffect(() => {
    if (themeMode !== "system") return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    // Update theme when system preference changes
    const handleChange = (e: MediaQueryListEvent) => {
      setEffectiveTheme(e.matches ? "dark" : "light");
    };

    // Add event listener
    mediaQuery.addEventListener("change", handleChange);

    // Initial check
    setEffectiveTheme(mediaQuery.matches ? "dark" : "light");

    // Cleanup
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [themeMode]);

  // Update effective theme when theme mode changes
  useEffect(() => {
    if (themeMode !== "system") {
      setEffectiveTheme(themeMode);
    }
  }, [themeMode]);

  // Update theme when effectiveTheme or customThemeConfig changes
  useEffect(() => {
    // Start with the appropriate base theme
    let baseTheme = effectiveTheme === "dark" ? darkTheme : defaultTheme;

    // Apply custom theme overrides if available
    if (customThemeConfig?.theme) {
      // Select the appropriate theme mode
      const customTheme =
        effectiveTheme === "dark"
          ? customThemeConfig.theme.dark
          : customThemeConfig.theme.light;

      // Merge custom theme with base theme (keeping base as fallback)
      if (customTheme) {
        baseTheme = deepMerge(baseTheme, customTheme);
      }
    }

    setTheme(baseTheme);

    // Save to localStorage
    if (typeof window !== "undefined") {
      // Update data-theme attributes on document for potential CSS selectors
      document.documentElement.setAttribute("data-theme", effectiveTheme);

      if (customThemeConfig?.name) {
        document.documentElement.setAttribute(
          "data-theme-name",
          customThemeConfig.name,
        );
      } else {
        document.documentElement.removeAttribute("data-theme-name");
      }
    }
  }, [effectiveTheme, customThemeConfig]);

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

    // Typography (font families)
    if (theme.typography?.fontFamily) {
      if (theme.typography.fontFamily.body) {
        root.style.setProperty(
          "--theme-font-body",
          theme.typography.fontFamily.body,
        );
      }
      if (theme.typography.fontFamily.heading) {
        root.style.setProperty(
          "--theme-font-heading",
          theme.typography.fontFamily.heading,
        );
      }
      if (theme.typography.fontFamily.semibold) {
        root.style.setProperty(
          "--theme-font-semibold",
          theme.typography.fontFamily.semibold,
        );
      }
      if (theme.typography.fontFamily.headingBold) {
        root.style.setProperty(
          "--theme-font-heading-bold",
          theme.typography.fontFamily.headingBold,
        );
      }
    }
  }, [theme]);

  const toggleTheme = (mode: ThemeMode) => {
    localStorage.setItem(THEME_MODE_LOCAL_STORAGE_KEY, mode);
    setThemeMode(mode);
  };

  const contextValue: ThemeContextType = {
    theme,
    themeMode,
    setThemeMode: toggleTheme,
    isCustomTheme,
    customThemeName: customThemeConfig?.name,
    customThemeConfig,
    effectiveTheme,
    iconMappings,
  };

  return (
    <ThemeContext.Provider value={contextValue}>
      <ThemeApplier />
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
