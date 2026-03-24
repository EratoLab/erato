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

export interface ThemeProviderProps extends PropsWithChildren {
  enableCustomTheme?: boolean;
  initialThemeMode?: ThemeMode;
  persistThemeMode?: boolean;
}

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

const THEME_FONTS_MARKER = 'link[data-theme-fonts="true"]';
const THEME_STYLES_MARKER = 'link[data-theme-styles="true"]';
const THEME_VARS_MARKER = 'style[data-theme-vars="true"]';

const removeThemeStylesheets = () => {
  document.querySelector(THEME_FONTS_MARKER)?.remove();
  document.querySelector(THEME_STYLES_MARKER)?.remove();
};

const removeThemeVariablesStyle = () => {
  document.querySelector(THEME_VARS_MARKER)?.remove();
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

const getThemeVariableEntries = (theme: Theme): Array<[string, string]> => {
  const typography = theme.typography ?? defaultTheme.typography;
  if (!typography) {
    throw new Error("Default theme typography is not configured");
  }

  return [
    ["--theme-bg-primary", theme.colors.background.primary],
    ["--theme-bg-secondary", theme.colors.background.secondary],
    ["--theme-bg-tertiary", theme.colors.background.tertiary],
    ["--theme-bg-sidebar", theme.colors.background.sidebar],
    ["--theme-bg-accent", theme.colors.background.accent],
    ["--theme-bg-hover", theme.colors.background.hover],
    ["--theme-bg-selected", theme.colors.background.selected],
    ["--theme-fg-primary", theme.colors.foreground.primary],
    ["--theme-fg-secondary", theme.colors.foreground.secondary],
    ["--theme-fg-muted", theme.colors.foreground.muted],
    ["--theme-fg-accent", theme.colors.foreground.accent],
    ["--theme-action-primary-bg", theme.colors.action.primary.background],
    ["--theme-action-primary-fg", theme.colors.action.primary.foreground],
    ["--theme-action-primary-hover", theme.colors.action.primary.hover],
    ["--theme-border", theme.colors.border.default],
    ["--theme-border-primary", theme.colors.border.primary],
    ["--theme-border-subtle", theme.colors.border.subtle],
    ["--theme-border-strong", theme.colors.border.strong],
    ["--theme-border-divider", theme.colors.border.divider],
    ["--theme-border-focus", theme.colors.border.focus],
    ["--theme-shell-app", theme.colors.shell.app],
    ["--theme-shell-page", theme.colors.shell.page],
    ["--theme-shell-sidebar", theme.colors.shell.sidebar],
    ["--theme-shell-sidebar-hover", theme.colors.shell.sidebarHover],
    ["--theme-shell-sidebar-selected", theme.colors.shell.sidebarSelected],
    ["--theme-shell-chat-header", theme.colors.shell.chatHeader],
    ["--theme-shell-chat-body", theme.colors.shell.chatBody],
    ["--theme-shell-chat-input", theme.colors.shell.chatInput],
    ["--theme-shell-modal", theme.colors.shell.modal],
    ["--theme-shell-dropdown", theme.colors.shell.dropdown],
    ["--theme-overlay-modal", theme.colors.overlay.modal],
    ["--theme-message-user", theme.colors.message.user],
    ["--theme-message-assistant", theme.colors.message.assistant],
    ["--theme-message-hover", theme.colors.message.hover],
    ["--theme-message-controls", theme.colors.message.controls],
    ["--theme-messageItem-hover", theme.colors.message.hover],
    ["--theme-code-inline-bg", theme.colors.code.inline.background],
    ["--theme-code-inline-fg", theme.colors.code.inline.foreground],
    ["--theme-code-inline-border", theme.colors.code.inline.border],
    ["--theme-code-block-bg", theme.colors.code.block.background],
    ["--theme-code-block-fg", theme.colors.code.block.foreground],
    ["--theme-code-block-border", theme.colors.code.block.border],
    ["--theme-code-syntax-comment", theme.colors.code.syntax.comment],
    ["--theme-code-syntax-keyword", theme.colors.code.syntax.keyword],
    ["--theme-code-syntax-string", theme.colors.code.syntax.string],
    ["--theme-code-syntax-function", theme.colors.code.syntax.function],
    ["--theme-code-syntax-number", theme.colors.code.syntax.number],
    ["--theme-radius-base", theme.radius.base],
    ["--theme-radius-shell", theme.radius.shell],
    ["--theme-radius-input", theme.radius.input],
    ["--theme-radius-control", theme.radius.control],
    ["--theme-radius-message", theme.radius.message],
    ["--theme-radius-modal", theme.radius.modal],
    ["--theme-radius-pill", theme.radius.pill],
    ["--theme-spacing-shell-padding-x", theme.spacing.shell.paddingX],
    ["--theme-spacing-shell-padding-y", theme.spacing.shell.paddingY],
    ["--theme-spacing-shell-gap", theme.spacing.shell.gap],
    [
      "--theme-spacing-shell-compact-padding-x",
      theme.spacing.shell.compactPaddingX,
    ],
    [
      "--theme-spacing-shell-compact-padding-y",
      theme.spacing.shell.compactPaddingY,
    ],
    ["--theme-spacing-message-padding-x", theme.spacing.message.paddingX],
    ["--theme-spacing-message-padding-y", theme.spacing.message.paddingY],
    ["--theme-spacing-message-gap", theme.spacing.message.gap],
    ["--theme-spacing-control-gap", theme.spacing.control.gap],
    ["--theme-spacing-control-padding-x", theme.spacing.control.paddingX],
    ["--theme-spacing-control-padding-y", theme.spacing.control.paddingY],
    ["--theme-spacing-control-min-height", theme.spacing.control.minHeight],
    ["--theme-spacing-sidebar-row-height", theme.spacing.sidebar.rowHeight],
    [
      "--theme-spacing-input-compact-padding-x",
      theme.spacing.input.compactPaddingX,
    ],
    [
      "--theme-spacing-input-compact-padding-y",
      theme.spacing.input.compactPaddingY,
    ],
    ["--theme-spacing-input-padding-x", theme.spacing.input.paddingX],
    ["--theme-spacing-input-padding-y", theme.spacing.input.paddingY],
    ["--theme-spacing-input-gap", theme.spacing.input.gap],
    ["--theme-spacing-input-min-height", theme.spacing.input.minHeight],
    ["--theme-spacing-dropdown-padding-x", theme.spacing.dropdown.paddingX],
    ["--theme-spacing-dropdown-padding-y", theme.spacing.dropdown.paddingY],
    [
      "--theme-spacing-dropdown-chrome-padding-y",
      theme.spacing.dropdown.chromePaddingY,
    ],
    ["--theme-spacing-modal-padding", theme.spacing.modal.padding],
    [
      "--theme-spacing-modal-close-button-padding",
      theme.spacing.modal.closeButtonPadding,
    ],
    ["--theme-elevation-shell", theme.elevation.shell],
    ["--theme-elevation-input", theme.elevation.input],
    ["--theme-elevation-modal", theme.elevation.modal],
    ["--theme-elevation-dropdown", theme.elevation.dropdown],
    [
      "--theme-layout-chat-content-max-width",
      theme.layout.chat.contentMaxWidth,
    ],
    ["--theme-layout-chat-input-max-width", theme.layout.chat.inputMaxWidth],
    [
      "--theme-layout-chat-image-preview-max-width",
      theme.layout.chat.imagePreviewMaxWidth,
    ],
    [
      "--theme-layout-chat-image-preview-max-height",
      theme.layout.chat.imagePreviewMaxHeight,
    ],
    ["--theme-layout-sidebar-width", theme.layout.sidebar.width],
    ["--theme-layout-sidebar-slim-width", theme.layout.sidebar.slimWidth],
    ["--theme-layout-dropdown-min-width", theme.layout.dropdown.minWidth],
    [
      "--theme-layout-dropdown-viewport-margin",
      theme.layout.dropdown.viewportMargin,
    ],
    ["--theme-layout-modal-backdrop-blur", theme.layout.modal.backdropBlur],
    ["--theme-layout-modal-max-height", theme.layout.modal.maxHeight],
    ["--theme-layout-modal-max-width", theme.layout.modal.maxWidth],
    ["--theme-layout-modal-viewport-margin", theme.layout.modal.viewportMargin],
    ["--theme-avatar-user-bg", theme.colors.avatar.user.background],
    ["--theme-avatar-user-fg", theme.colors.avatar.user.foreground],
    ["--theme-avatar-assistant-bg", theme.colors.avatar.assistant.background],
    ["--theme-avatar-assistant-fg", theme.colors.avatar.assistant.foreground],
    ["--theme-info-fg", theme.colors.status.info.foreground],
    ["--theme-info-bg", theme.colors.status.info.background],
    ["--theme-info-border", theme.colors.status.info.border],
    ["--theme-success-fg", theme.colors.status.success.foreground],
    ["--theme-success-bg", theme.colors.status.success.background],
    ["--theme-success-border", theme.colors.status.success.border],
    ["--theme-warning-fg", theme.colors.status.warning.foreground],
    ["--theme-warning-bg", theme.colors.status.warning.background],
    ["--theme-warning-border", theme.colors.status.warning.border],
    ["--theme-error-fg", theme.colors.status.error.foreground],
    ["--theme-error-bg", theme.colors.status.error.background],
    ["--theme-error-border", theme.colors.status.error.border],
    ["--theme-focus-ring", theme.colors.focus.ring],
    ["--theme-focus-ring-error", theme.colors.focus.errorRing],
    ["--theme-font-body", typography.fontFamily.body],
    ["--theme-font-heading", typography.fontFamily.heading],
    ["--theme-font-semibold", typography.fontFamily.semibold],
    ["--theme-font-heading-bold", typography.fontFamily.headingBold],
    ["--theme-font-mono", typography.fontFamily.mono],
    ["--theme-font-size-xs", typography.fontSize.xs],
    ["--theme-font-size-sm", typography.fontSize.sm],
    ["--theme-font-size-base", typography.fontSize.base],
    ["--theme-font-size-lg", typography.fontSize.lg],
    ["--theme-font-size-xl", typography.fontSize.xl],
    ["--theme-font-size-2xl", typography.fontSize["2xl"]],
    ["--theme-line-height-xs", typography.lineHeight.xs],
    ["--theme-line-height-sm", typography.lineHeight.sm],
    ["--theme-line-height-base", typography.lineHeight.base],
    ["--theme-line-height-lg", typography.lineHeight.lg],
    ["--theme-line-height-xl", typography.lineHeight.xl],
    ["--theme-line-height-2xl", typography.lineHeight["2xl"]],
    ["--theme-letter-spacing-xs", typography.letterSpacing.xs],
    ["--theme-letter-spacing-sm", typography.letterSpacing.sm],
    ["--theme-letter-spacing-base", typography.letterSpacing.base],
    ["--theme-letter-spacing-lg", typography.letterSpacing.lg],
    ["--theme-letter-spacing-xl", typography.letterSpacing.xl],
    ["--theme-letter-spacing-2xl", typography.letterSpacing["2xl"]],
    ["--theme-font-weight-normal", typography.fontWeight.normal],
    ["--theme-font-weight-medium", typography.fontWeight.medium],
    ["--theme-font-weight-semibold", typography.fontWeight.semibold],
    ["--theme-font-weight-bold", typography.fontWeight.bold],
  ];
};

const buildThemeVariablesCss = (theme: Theme): string =>
  `:root {\n${getThemeVariableEntries(theme)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join("\n")}\n}`;

const syncThemeVariablesStyle = (theme: Theme) => {
  const root = document.documentElement;
  const inlineStyle = root.style;

  for (const [name] of getThemeVariableEntries(theme)) {
    inlineStyle.removeProperty(name);
  }

  let style = document.querySelector<HTMLStyleElement>(THEME_VARS_MARKER);
  if (!style) {
    style = document.createElement("style");
    style.setAttribute("data-theme-vars", "true");
  }

  style.textContent = buildThemeVariablesCss(theme);

  const themeStylesheet = document.querySelector(THEME_STYLES_MARKER);
  if (themeStylesheet) {
    document.head.insertBefore(style, themeStylesheet);
    return;
  }

  if (!style.parentNode) {
    document.head.appendChild(style);
  }
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

export function ThemeProvider({
  children,
  enableCustomTheme = true,
  initialThemeMode,
  persistThemeMode = true,
}: ThemeProviderProps) {
  const savedOrDefaultThemeMode = initialThemeMode ?? getSavedTheme();
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
    if (!enableCustomTheme) {
      setCustomThemeConfig(null);
      setResolvedThemeConfigPath(null);
      setIsCustomTheme(false);
      setIconMappings(undefined);
      return;
    }

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
  }, [enableCustomTheme]);

  // Load custom theme stylesheets when a custom theme is active
  useEffect(() => {
    removeThemeStylesheets();

    if (!enableCustomTheme || !customThemeConfig) return;
    if (!resolvedThemeConfigPath) return;

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

    const themeVariablesStyle = document.querySelector(THEME_VARS_MARKER);
    const themeStylesheet = document.querySelector(THEME_STYLES_MARKER);
    if (themeVariablesStyle && themeStylesheet) {
      document.head.insertBefore(themeVariablesStyle, themeStylesheet);
    }

    return () => {
      removeThemeStylesheets();
    };
  }, [customThemeConfig, enableCustomTheme, resolvedThemeConfigPath]);

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
    syncThemeVariablesStyle(theme);

    return () => {
      removeThemeVariablesStyle();
    };
  }, [theme]);

  const toggleTheme = (mode: ThemeMode) => {
    if (persistThemeMode) {
      localStorage.setItem(THEME_MODE_LOCAL_STORAGE_KEY, mode);
    }
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
