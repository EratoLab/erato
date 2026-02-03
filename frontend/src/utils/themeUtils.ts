// Utility functions for theme handling
import type { Theme } from "@/config/theme";

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
    light?: Partial<Theme>;
    dark?: Partial<Theme>;
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

/**
 * Check if a file exists at the specified URL
 */
export async function checkFileExists(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "HEAD" });
    return response.ok;
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
