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
}

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
    // 1. Check environment variables first for complete path override
    const { themeLogoDarkPath, themeLogoPath, themePath, themeCustomerName } =
      env();
    if (isDark && themeLogoDarkPath) {
      return themeLogoDarkPath;
    }

    if (!isDark && themeLogoPath) {
      return themeLogoPath;
    }

    // 2. Check for theme path override
    if (themePath) {
      return isDark ? `${themePath}/logo-dark.svg` : `${themePath}/logo.svg`;
    }

    // 3. If a customer name is specified, use customer-specific subfolder
    if (themeCustomerName) {
      return isDark
        ? `/custom-theme/${themeCustomerName}/logo-dark.svg`
        : `/custom-theme/${themeCustomerName}/logo.svg`;
    }

    // 4. Default to the root custom-theme folder (no customer subfolder)
    return isDark ? "/custom-theme/logo-dark.svg" : "/custom-theme/logo.svg";
  },
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
