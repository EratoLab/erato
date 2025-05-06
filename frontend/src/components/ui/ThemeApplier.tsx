/* eslint-disable @typescript-eslint/no-unnecessary-condition */
"use client";

import { useEffect } from "react";

import { env } from "@/app/env";
import { useTheme } from "@/components/providers/ThemeProvider";
import { loadThemeFromPath } from "@/utils/themeUtils";

/**
 * A utility component that applies theme properties to CSS variables
 * This is used to apply custom theme properties defined in theme.json
 */
export function ThemeApplier() {
  const { effectiveTheme, isCustomTheme } = useTheme();

  useEffect(() => {
    if (!isCustomTheme) return;

    // Get the customer name from environment variable (lowercase folder name)
    const customerName = env().themeCustomerName;
    if (!customerName) return;

    // Load the theme data
    const loadTheme = async () => {
      try {
        // Use the folder name directly for the path, not the theme name from theme.json
        const themePath = `/custom-theme/${customerName}/theme.json`;

        // Load the theme data
        const themeData = await loadThemeFromPath(themePath);
        if (!themeData) return;

        const root = document.documentElement;
        const colors = themeData.theme[effectiveTheme]?.colors;

        if (!colors) return;

        // Apply custom background colors
        if (colors.background) {
          const bg = colors.background;
          if (bg.primary)
            root.style.setProperty("--theme-bg-primary", bg.primary);
          if (bg.secondary)
            root.style.setProperty("--theme-bg-secondary", bg.secondary);
          if (bg.tertiary)
            root.style.setProperty("--theme-bg-tertiary", bg.tertiary);
          if (bg.sidebar)
            root.style.setProperty("--theme-bg-sidebar", bg.sidebar);
          if (bg.accent) root.style.setProperty("--theme-bg-accent", bg.accent);
          if (bg.hover) root.style.setProperty("--theme-bg-hover", bg.hover);
          if (bg.selected)
            root.style.setProperty("--theme-bg-selected", bg.selected);
        }

        // Apply custom message item colors if they exist
        // Need type check since messageItem is a custom extension to ThemeColors
        if (
          "messageItem" in colors &&
          typeof colors.messageItem === "object" &&
          colors.messageItem !== null
        ) {
          const mi = colors.messageItem as { hover?: string };
          if (mi.hover)
            root.style.setProperty("--theme-messageItem-hover", mi.hover);
        }

        // Apply custom foreground colors
        if (colors.foreground) {
          const fg = colors.foreground;
          if (fg.primary)
            root.style.setProperty("--theme-fg-primary", fg.primary);
          if (fg.secondary)
            root.style.setProperty("--theme-fg-secondary", fg.secondary);
          if (fg.muted) root.style.setProperty("--theme-fg-muted", fg.muted);
          if (fg.accent) root.style.setProperty("--theme-fg-accent", fg.accent);
        }

        // Apply custom border colors
        if (colors.border) {
          const border = colors.border;
          if (border.default)
            root.style.setProperty("--theme-border", border.default);
          if (border.strong)
            root.style.setProperty("--theme-border-strong", border.strong);
          if (border.focus)
            root.style.setProperty("--theme-border-focus", border.focus);
        }

        // Apply custom avatar colors
        if (colors.avatar) {
          // User avatar
          if (colors.avatar.user) {
            const user = colors.avatar.user;
            if (user.background)
              root.style.setProperty("--theme-avatar-user-bg", user.background);
            if (user.foreground)
              root.style.setProperty("--theme-avatar-user-fg", user.foreground);
          }

          // Assistant avatar
          if (colors.avatar.assistant) {
            const assistant = colors.avatar.assistant;
            if (assistant.background)
              root.style.setProperty(
                "--theme-avatar-assistant-bg",
                assistant.background,
              );
            if (assistant.foreground)
              root.style.setProperty(
                "--theme-avatar-assistant-fg",
                assistant.foreground,
              );
          }
        }

        // Apply custom focus colors
        if (colors.focus) {
          const focus = colors.focus;
          if (focus.ring)
            root.style.setProperty("--theme-focus-ring", focus.ring);
        }

        // Apply status colors
        if (colors.status) {
          // Info
          if (colors.status.info) {
            const info = colors.status.info;
            if (info.foreground)
              root.style.setProperty("--theme-info-fg", info.foreground);
            if (info.background)
              root.style.setProperty("--theme-info-bg", info.background);
            if (info.border)
              root.style.setProperty("--theme-info-border", info.border);
          }

          // Success
          if (colors.status.success) {
            const success = colors.status.success;
            if (success.foreground)
              root.style.setProperty("--theme-success-fg", success.foreground);
            if (success.background)
              root.style.setProperty("--theme-success-bg", success.background);
            if (success.border)
              root.style.setProperty("--theme-success-border", success.border);
          }

          // Warning
          if (colors.status.warning) {
            const warning = colors.status.warning;
            if (warning.foreground)
              root.style.setProperty("--theme-warning-fg", warning.foreground);
            if (warning.background)
              root.style.setProperty("--theme-warning-bg", warning.background);
            if (warning.border)
              root.style.setProperty("--theme-warning-border", warning.border);
          }

          // Error
          if (colors.status.error) {
            const error = colors.status.error;
            if (error.foreground)
              root.style.setProperty("--theme-error-fg", error.foreground);
            if (error.background)
              root.style.setProperty("--theme-error-bg", error.background);
            if (error.border)
              root.style.setProperty("--theme-error-border", error.border);
          }
        }
      } catch (error) {
        console.error("Error loading theme:", error);
      }
    };

    void loadTheme();
  }, [effectiveTheme, isCustomTheme]);

  // This component doesn't render anything
  return null;
}
