// Utility functions for theme handling
import type { Theme, ThemeOverride } from "@/config/theme";

/**
 * Page alignment options
 */
export type PageAlignment = "left" | "center" | "right";

/**
 * Page max-width options (maps to Tailwind max-w-* classes)
 */
export type PageMaxWidth = "2xl" | "4xl" | "6xl" | "full";

/**
 * Layout configuration for pages
 */
export interface LayoutConfig {
  pages?: {
    assistants?: {
      alignment?: PageAlignment;
      maxWidth?: PageMaxWidth;
    };
    search?: {
      alignment?: PageAlignment;
      maxWidth?: PageMaxWidth;
    };
    headers?: {
      alignment?: PageAlignment;
      maxWidth?: PageMaxWidth;
    };
  };
}

/**
 * Custom theme configuration interface
 */
export interface CustomThemeConfig {
  name: string;
  logo?: {
    path: string;
    darkPath?: string;
  };
  theme: {
    light?: ThemeOverride;
    dark?: ThemeOverride;
  };
  branding?: {
    welcomeScreen?: {
      enabled: boolean;
      logoSize: "small" | "medium" | "large";
    };
  };
  icons?: {
    fileTypes?: Record<string, string>;
    status?: Record<string, string>;
    actions?: Record<string, string>;
    navigation?: Record<string, string>;
  };
  layout?: LayoutConfig;
}

/**
 * Deeply merges two objects together.
 * Target properties are preserved if not present in source.
 */
export function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source?: Partial<T>,
): T {
  // If source is undefined or null, return the target
  if (!source) return target;

  // Create a new object to avoid mutating the target
  const result = { ...target };

  // Iterate through all source properties
  Object.keys(source).forEach((key) => {
    // Get the key as a proper key of T
    const typedKey = key as keyof T;
    const sourceValue = source[typedKey];
    const targetValue = target[typedKey];

    // If both values are objects (but not arrays or null), recursively merge them
    if (
      sourceValue !== null &&
      targetValue !== null &&
      typeof sourceValue === "object" &&
      typeof targetValue === "object" &&
      !Array.isArray(sourceValue) &&
      !Array.isArray(targetValue)
    ) {
      result[typedKey] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>,
      ) as T[keyof T];
    } else {
      // Otherwise, use the source value directly
      result[typedKey] = sourceValue as T[keyof T];
    }
  });

  return result;
}

const withBorderRadiusCompatibility = (
  theme: Theme,
  override?: ThemeOverride,
): Theme => {
  if (!override?.borderRadius) return theme;

  return {
    ...theme,
    radius: {
      ...theme.radius,
      base: override.radius?.base ?? theme.borderRadius,
      shell: override.radius?.shell ?? theme.borderRadius,
      input: override.radius?.input ?? theme.borderRadius,
      message: override.radius?.message ?? theme.borderRadius,
      modal: override.radius?.modal ?? theme.borderRadius,
      pill: override.radius?.pill ?? theme.borderRadius,
    },
  };
};

const withLegacyColorCompatibility = (
  theme: Theme,
  override?: ThemeOverride,
): Theme => {
  const colorsOverride = override?.colors;
  if (!colorsOverride) return theme;

  const legacyMessageHover = colorsOverride.messageItem?.hover;
  const nextTheme: Theme = {
    ...theme,
    colors: {
      ...theme.colors,
      border: { ...theme.colors.border },
      shell: { ...theme.colors.shell },
      message: { ...theme.colors.message },
    },
  };

  if (colorsOverride.background?.primary) {
    if (!colorsOverride.shell?.app) {
      nextTheme.colors.shell.app = theme.colors.background.primary;
    }
    if (!colorsOverride.shell?.modal) {
      nextTheme.colors.shell.modal = theme.colors.background.primary;
    }
    if (!colorsOverride.shell?.dropdown) {
      nextTheme.colors.shell.dropdown = theme.colors.background.primary;
    }
    if (!colorsOverride.message?.user) {
      nextTheme.colors.message.user = theme.colors.background.primary;
    }
  }

  if (colorsOverride.background?.secondary) {
    if (!colorsOverride.shell?.page) {
      nextTheme.colors.shell.page = theme.colors.background.secondary;
    }
    if (!colorsOverride.shell?.chatHeader) {
      nextTheme.colors.shell.chatHeader = theme.colors.background.secondary;
    }
    if (!colorsOverride.shell?.chatBody) {
      nextTheme.colors.shell.chatBody = theme.colors.background.secondary;
    }
    if (!colorsOverride.message?.assistant) {
      nextTheme.colors.message.assistant = theme.colors.background.secondary;
    }
    if (!colorsOverride.message?.controls) {
      nextTheme.colors.message.controls = theme.colors.background.secondary;
    }
  }

  if (colorsOverride.background?.tertiary && !colorsOverride.shell?.chatInput) {
    nextTheme.colors.shell.chatInput = theme.colors.background.tertiary;
  }

  if (colorsOverride.background?.sidebar && !colorsOverride.shell?.sidebar) {
    nextTheme.colors.shell.sidebar = theme.colors.background.sidebar;
  }

  if (colorsOverride.background?.hover) {
    if (!colorsOverride.shell?.sidebarHover) {
      nextTheme.colors.shell.sidebarHover = theme.colors.background.hover;
    }
    if (!colorsOverride.message?.hover && !legacyMessageHover) {
      nextTheme.colors.message.hover = theme.colors.background.hover;
    }
  }

  if (
    colorsOverride.background?.selected &&
    !colorsOverride.shell?.sidebarSelected
  ) {
    nextTheme.colors.shell.sidebarSelected = theme.colors.background.selected;
  }

  if (legacyMessageHover && !colorsOverride.message?.hover) {
    nextTheme.colors.message.hover = legacyMessageHover;
  }

  if (colorsOverride.border?.default) {
    if (!colorsOverride.border.subtle) {
      nextTheme.colors.border.subtle = theme.colors.border.default;
    }
    if (!colorsOverride.border.divider) {
      nextTheme.colors.border.divider = theme.colors.border.default;
    }
  }

  return nextTheme;
};

export function mergeThemeWithOverrides(
  baseTheme: Theme,
  override?: ThemeOverride,
): Theme {
  const mergedTheme = deepMerge(baseTheme, override as Partial<Theme>);

  return withLegacyColorCompatibility(
    withBorderRadiusCompatibility(mergedTheme, override),
    override,
  );
}

/**
 * Check if a file exists at the specified URL
 */
export async function checkFileExists(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "HEAD" });
    if (!response.ok) return false;

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("text/html")) return false;

    return true;
  } catch (error) {
    console.error(`Error checking if file exists at ${url}`, error);
    return false;
  }
}

/**
 * Load a theme configuration from a given path
 * @param path Path to the theme JSON file
 * @returns The loaded theme configuration or null if loading failed
 */
export async function loadThemeFromPath(
  path: string,
): Promise<CustomThemeConfig | null> {
  try {
    const response = await fetch(path);
    if (!response.ok) {
      console.error(
        `Failed to load theme from ${path}: ${response.statusText}`,
      );
      return null;
    }
    return (await response.json()) as CustomThemeConfig;
  } catch (error) {
    console.error(`Error loading theme from ${path}:`, error);
    return null;
  }
}
