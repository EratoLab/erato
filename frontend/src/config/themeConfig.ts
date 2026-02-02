/**
 * Theme Configuration
 * Defines how custom themes are loaded and configured
 */
import { env } from "@/app/env";

import type { CustomThemeConfig } from "@/utils/themeUtils";

/**
 * Theme location configuration
 */
export interface ThemeLocationConfig {
  /**
   * List of paths to look for theme files in priority order
   * Paths can be static or derived from environment variables
   */
  getThemePaths: () => Array<string | null | undefined>;

  /**
   * Function to determine logo paths based on theme name and mode
   * @param themeName The name of the loaded theme
   * @param isDark Whether dark mode is active
   * @returns Path to the logo file
   */
  getLogoPath: (themeName: string | undefined, isDark: boolean) => string;

  /**
   * Function to determine assistant avatar path
   * @param themeName The name of the loaded theme
   * @returns Path to the assistant avatar file, or null if not available
   */
  getAssistantAvatarPath: (themeName: string | undefined) => string | null;

  /**
   * Function to determine sidebar logo paths based on theme name and mode
   * @param themeName The name of the loaded theme
   * @param isDark Whether dark mode is active
   * @returns Path to the sidebar logo file, or null if not available (falls back to regular logo)
   */
  getSidebarLogoPath: (
    themeName: string | undefined,
    isDark: boolean,
  ) => string | null;
}

/**
 * Resolves asset paths with priority fallback:
 * 1. Environment variable override
 * 2. Theme path override
 * 3. Customer-specific path
 * 4. Default path or null
 */
const resolveAssetPath = (options: {
  envPaths: { light?: string | null; dark?: string | null };
  baseFilename: string;
  isDark?: boolean;
  hasDefault?: boolean;
}): string | null => {
  const { envPaths, baseFilename, isDark = false, hasDefault = true } = options;
  const { themePath, themeCustomerName } = env();

  // 1. Environment variable override
  const envPath = isDark ? envPaths.dark : envPaths.light;
  if (envPath) return envPath;

  // 2. Theme path override
  if (themePath) {
    return isDark
      ? `${themePath}/${baseFilename}-dark.svg`
      : `${themePath}/${baseFilename}.svg`;
  }

  // 3. Customer-specific subfolder
  if (themeCustomerName) {
    return isDark
      ? `/custom-theme/${themeCustomerName}/${baseFilename}-dark.svg`
      : `/custom-theme/${themeCustomerName}/${baseFilename}.svg`;
  }

  // 4. Default fallback or null
  if (!hasDefault) return null;

  return isDark
    ? `/custom-theme/${baseFilename}-dark.svg`
    : `/custom-theme/${baseFilename}.svg`;
};

/**
 * Default theme configuration
 */
export const defaultThemeConfig: ThemeLocationConfig = {
  getThemePaths: () => {
    return [
      // 1. Environment variable override for entire path
      env().themeConfigPath,

      // 2. Customer-specific theme based on environment variable
      env().themeCustomerName
        ? `/custom-theme/${env().themeCustomerName}/theme.json`
        : null,

      // 3. Custom theme override path
      env().themePath ? `${env().themePath}/theme.json` : null,

      // 4. Fallback to default location (no customer subfolder)
      "/custom-theme/theme.json",
    ];
  },

  getLogoPath: (themeName, isDark) => {
    const path = resolveAssetPath({
      envPaths: { light: env().themeLogoPath, dark: env().themeLogoDarkPath },
      baseFilename: "logo",
      isDark,
      hasDefault: true,
    });
    // Logo always has a default, so path will never be null
    return path ?? "/custom-theme/logo.svg";
  },

  getAssistantAvatarPath: (themeName) =>
    resolveAssetPath({
      envPaths: { light: env().themeAssistantAvatarPath },
      baseFilename: "assistant-avatar",
      hasDefault: false,
    }),

  getSidebarLogoPath: (themeName, isDark) =>
    resolveAssetPath({
      envPaths: {
        light: env().sidebarLogoPath,
        dark: env().sidebarLogoDarkPath,
      },
      baseFilename: "sidebar-logo",
      isDark,
      hasDefault: false,
    }),
};

/**
 * Loads a theme from the configured theme paths
 * @param config Theme location configuration
 * @returns The loaded theme config or null if no theme was found
 */
export async function loadThemeConfig(
  config: ThemeLocationConfig = defaultThemeConfig,
): Promise<CustomThemeConfig | null> {
  try {
    // Try paths in priority order
    const pathsToTry = config.getThemePaths().filter(Boolean) as string[];

    for (const path of pathsToTry) {
      try {
        const response = await fetch(path);
        if (response.ok) {
          const themeConfig = await response.json();
          console.log(`Custom theme loaded: ${themeConfig.name} from ${path}`);
          return themeConfig;
        }
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (error) {
        console.log(`Theme not found at ${path}, trying next location`);
      }
    }

    console.log("No custom theme found, using default theme");
    return null;
  } catch (error) {
    console.error("Failed to load any theme", error);
    return null;
  }
}
