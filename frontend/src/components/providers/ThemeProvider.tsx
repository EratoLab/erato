/* eslint-disable lingui/no-unlocalized-strings */
"use client";

import { createContext, useContext, useEffect, useState } from "react";

import { defaultTheme, darkTheme } from "@/config/theme";
import {
  defaultThemeConfig,
  loadResolvedThemeConfig,
  resolveIconPaths,
} from "@/config/themeConfig";
import {
  mergeThemeWithOverrides,
  type CustomThemeConfig,
} from "@/utils/themeUtils";

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

const removeThemeStylesheets = () => {
  document.querySelector('link[data-theme-fonts="true"]')?.remove();
  document.querySelector('link[data-theme-styles="true"]')?.remove();
};

const appendThemeStylesheet = (
  href: string | null,
  marker: "data-theme-fonts" | "data-theme-styles",
) => {
  if (!href) return;

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.setAttribute(marker, "true");
  document.head.appendChild(link);
};

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
  const [resolvedThemeConfigPath, setResolvedThemeConfigPath] = useState<
    string | null
  >(null);
  const [isCustomTheme, setIsCustomTheme] = useState(false);
  const [iconMappings, setIconMappings] = useState<{
    fileTypes?: Record<string, string>;
    status?: Record<string, string>;
    actions?: Record<string, string>;
    navigation?: Record<string, string>;
  }>();

  // Initialize theme from saved settings and try to load custom theme
  useEffect(() => {
    let isMounted = true;

    // Load theme using the configuration module
    const loadTheme = async () => {
      const loadedTheme = await loadResolvedThemeConfig(defaultThemeConfig);

      if (!isMounted) return;

      if (loadedTheme) {
        const { themeConfig, themeConfigPath } = loadedTheme;

        setCustomThemeConfig(themeConfig);
        setResolvedThemeConfigPath(themeConfigPath);
        setIsCustomTheme(true);
        // Resolve icon paths from theme config
        // Use undefined to let it fall back to env().themeCustomerName (e.g., "trilux-test")
        // instead of themeConfig.name (e.g., "Trilux Theme") which is the display name
        const resolvedIcons = resolveIconPaths(themeConfig.icons, undefined);
        setIconMappings(resolvedIcons);
        return;
      }

      setCustomThemeConfig(null);
      setResolvedThemeConfigPath(null);
      setIsCustomTheme(false);
      setIconMappings(undefined);
    };

    void loadTheme();

    return () => {
      isMounted = false;
    };
  }, []);

  // Load custom theme stylesheets when a custom theme is active
  useEffect(() => {
    removeThemeStylesheets();

    if (!customThemeConfig || !resolvedThemeConfigPath) return;

    const fontsCssPath = defaultThemeConfig.getFontsCssPath(
      customThemeConfig.name,
      resolvedThemeConfigPath,
    );
    const themeCssPath = defaultThemeConfig.getThemeCssPath(
      customThemeConfig.name,
      resolvedThemeConfigPath,
    );

    appendThemeStylesheet(fontsCssPath, "data-theme-fonts");
    appendThemeStylesheet(themeCssPath, "data-theme-styles");

    return () => {
      removeThemeStylesheets();
    };
  }, [customThemeConfig, resolvedThemeConfigPath]);

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

      if (customTheme) {
        baseTheme = mergeThemeWithOverrides(baseTheme, customTheme);
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
    const setCssVariable = (name: string, value: string) => {
      root.style.setProperty(name, value);
    };

    // Background colors
    setCssVariable("--theme-bg-primary", theme.colors.background.primary);
    setCssVariable("--theme-bg-secondary", theme.colors.background.secondary);
    setCssVariable("--theme-bg-tertiary", theme.colors.background.tertiary);
    setCssVariable("--theme-bg-sidebar", theme.colors.background.sidebar);
    setCssVariable("--theme-bg-accent", theme.colors.background.accent);
    setCssVariable("--theme-bg-hover", theme.colors.background.hover);
    setCssVariable("--theme-bg-selected", theme.colors.background.selected);

    // Foreground colors
    setCssVariable("--theme-fg-primary", theme.colors.foreground.primary);
    setCssVariable("--theme-fg-secondary", theme.colors.foreground.secondary);
    setCssVariable("--theme-fg-muted", theme.colors.foreground.muted);
    setCssVariable("--theme-fg-accent", theme.colors.foreground.accent);

    // Action colors
    setCssVariable(
      "--theme-action-primary-bg",
      theme.colors.action.primary.background,
    );
    setCssVariable(
      "--theme-action-primary-fg",
      theme.colors.action.primary.foreground,
    );
    setCssVariable(
      "--theme-action-primary-hover",
      theme.colors.action.primary.hover,
    );

    // Border colors
    setCssVariable("--theme-border", theme.colors.border.default);
    setCssVariable("--theme-border-primary", theme.colors.border.primary);
    setCssVariable("--theme-border-subtle", theme.colors.border.subtle);
    setCssVariable("--theme-border-strong", theme.colors.border.strong);
    setCssVariable("--theme-border-divider", theme.colors.border.divider);
    setCssVariable("--theme-border-focus", theme.colors.border.focus);

    // Shell and overlay surfaces
    setCssVariable("--theme-shell-app", theme.colors.shell.app);
    setCssVariable("--theme-shell-page", theme.colors.shell.page);
    setCssVariable("--theme-shell-sidebar", theme.colors.shell.sidebar);
    setCssVariable(
      "--theme-shell-sidebar-hover",
      theme.colors.shell.sidebarHover,
    );
    setCssVariable(
      "--theme-shell-sidebar-selected",
      theme.colors.shell.sidebarSelected,
    );
    setCssVariable("--theme-shell-chat-header", theme.colors.shell.chatHeader);
    setCssVariable("--theme-shell-chat-body", theme.colors.shell.chatBody);
    setCssVariable("--theme-shell-chat-input", theme.colors.shell.chatInput);
    setCssVariable("--theme-shell-modal", theme.colors.shell.modal);
    setCssVariable("--theme-shell-dropdown", theme.colors.shell.dropdown);
    setCssVariable("--theme-overlay-modal", theme.colors.overlay.modal);

    // Message surfaces
    setCssVariable("--theme-message-user", theme.colors.message.user);
    setCssVariable("--theme-message-assistant", theme.colors.message.assistant);
    setCssVariable("--theme-message-hover", theme.colors.message.hover);
    setCssVariable("--theme-message-controls", theme.colors.message.controls);
    setCssVariable("--theme-messageItem-hover", theme.colors.message.hover);

    // Radius
    setCssVariable("--theme-radius-base", theme.radius.base);
    setCssVariable("--theme-radius-shell", theme.radius.shell);
    setCssVariable("--theme-radius-input", theme.radius.input);
    setCssVariable("--theme-radius-message", theme.radius.message);
    setCssVariable("--theme-radius-modal", theme.radius.modal);
    setCssVariable("--theme-radius-pill", theme.radius.pill);

    // Spacing
    setCssVariable(
      "--theme-spacing-shell-padding-x",
      theme.spacing.shell.paddingX,
    );
    setCssVariable(
      "--theme-spacing-shell-padding-y",
      theme.spacing.shell.paddingY,
    );
    setCssVariable("--theme-spacing-shell-gap", theme.spacing.shell.gap);
    setCssVariable(
      "--theme-spacing-message-padding-x",
      theme.spacing.message.paddingX,
    );
    setCssVariable(
      "--theme-spacing-message-padding-y",
      theme.spacing.message.paddingY,
    );
    setCssVariable("--theme-spacing-message-gap", theme.spacing.message.gap);
    setCssVariable("--theme-spacing-control-gap", theme.spacing.control.gap);
    setCssVariable(
      "--theme-spacing-sidebar-row-height",
      theme.spacing.sidebar.rowHeight,
    );
    setCssVariable(
      "--theme-spacing-input-padding-x",
      theme.spacing.input.paddingX,
    );
    setCssVariable(
      "--theme-spacing-input-padding-y",
      theme.spacing.input.paddingY,
    );
    setCssVariable("--theme-spacing-input-gap", theme.spacing.input.gap);

    // Elevation
    setCssVariable("--theme-elevation-shell", theme.elevation.shell);
    setCssVariable("--theme-elevation-input", theme.elevation.input);
    setCssVariable("--theme-elevation-modal", theme.elevation.modal);
    setCssVariable("--theme-elevation-dropdown", theme.elevation.dropdown);

    // Layout
    setCssVariable(
      "--theme-layout-chat-content-max-width",
      theme.layout.chat.contentMaxWidth,
    );
    setCssVariable(
      "--theme-layout-chat-input-max-width",
      theme.layout.chat.inputMaxWidth,
    );
    setCssVariable("--theme-layout-sidebar-width", theme.layout.sidebar.width);

    // Avatar colors
    setCssVariable(
      "--theme-avatar-user-bg",
      theme.colors.avatar.user.background,
    );
    setCssVariable(
      "--theme-avatar-user-fg",
      theme.colors.avatar.user.foreground,
    );
    setCssVariable(
      "--theme-avatar-assistant-bg",
      theme.colors.avatar.assistant.background,
    );
    setCssVariable(
      "--theme-avatar-assistant-fg",
      theme.colors.avatar.assistant.foreground,
    );

    // Status colors
    // Info
    setCssVariable("--theme-info-fg", theme.colors.status.info.foreground);
    setCssVariable("--theme-info-bg", theme.colors.status.info.background);
    setCssVariable("--theme-info-border", theme.colors.status.info.border);

    // Success
    setCssVariable(
      "--theme-success-fg",
      theme.colors.status.success.foreground,
    );
    setCssVariable(
      "--theme-success-bg",
      theme.colors.status.success.background,
    );
    setCssVariable(
      "--theme-success-border",
      theme.colors.status.success.border,
    );

    // Warning
    setCssVariable(
      "--theme-warning-fg",
      theme.colors.status.warning.foreground,
    );
    setCssVariable(
      "--theme-warning-bg",
      theme.colors.status.warning.background,
    );
    setCssVariable(
      "--theme-warning-border",
      theme.colors.status.warning.border,
    );

    // Error
    setCssVariable("--theme-error-fg", theme.colors.status.error.foreground);
    setCssVariable("--theme-error-bg", theme.colors.status.error.background);
    setCssVariable("--theme-error-border", theme.colors.status.error.border);

    // Focus ring
    setCssVariable("--theme-focus-ring", theme.colors.focus.ring);
    setCssVariable("--theme-focus-ring-error", theme.colors.focus.errorRing);

    const typography = theme.typography ?? defaultTheme.typography;
    if (!typography) return;

    // Typography
    setCssVariable("--theme-font-body", typography.fontFamily.body);
    setCssVariable("--theme-font-heading", typography.fontFamily.heading);
    setCssVariable("--theme-font-semibold", typography.fontFamily.semibold);
    setCssVariable(
      "--theme-font-heading-bold",
      typography.fontFamily.headingBold,
    );
    setCssVariable("--theme-font-mono", typography.fontFamily.mono);

    setCssVariable("--theme-font-size-xs", typography.fontSize.xs);
    setCssVariable("--theme-font-size-sm", typography.fontSize.sm);
    setCssVariable("--theme-font-size-base", typography.fontSize.base);
    setCssVariable("--theme-font-size-lg", typography.fontSize.lg);
    setCssVariable("--theme-font-size-xl", typography.fontSize.xl);
    setCssVariable("--theme-font-size-2xl", typography.fontSize["2xl"]);

    setCssVariable("--theme-line-height-xs", typography.lineHeight.xs);
    setCssVariable("--theme-line-height-sm", typography.lineHeight.sm);
    setCssVariable("--theme-line-height-base", typography.lineHeight.base);
    setCssVariable("--theme-line-height-lg", typography.lineHeight.lg);
    setCssVariable("--theme-line-height-xl", typography.lineHeight.xl);
    setCssVariable("--theme-line-height-2xl", typography.lineHeight["2xl"]);

    setCssVariable(
      "--theme-letter-spacing-xs",
      typography.letterSpacing.xs,
    );
    setCssVariable(
      "--theme-letter-spacing-sm",
      typography.letterSpacing.sm,
    );
    setCssVariable(
      "--theme-letter-spacing-base",
      typography.letterSpacing.base,
    );
    setCssVariable(
      "--theme-letter-spacing-lg",
      typography.letterSpacing.lg,
    );
    setCssVariable(
      "--theme-letter-spacing-xl",
      typography.letterSpacing.xl,
    );
    setCssVariable(
      "--theme-letter-spacing-2xl",
      typography.letterSpacing["2xl"],
    );

    setCssVariable(
      "--theme-font-weight-normal",
      typography.fontWeight.normal,
    );
    setCssVariable(
      "--theme-font-weight-medium",
      typography.fontWeight.medium,
    );
    setCssVariable(
      "--theme-font-weight-semibold",
      typography.fontWeight.semibold,
    );
    setCssVariable("--theme-font-weight-bold", typography.fontWeight.bold);
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
