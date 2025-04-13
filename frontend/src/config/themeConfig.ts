/**
 * Theme Configuration
 * Defines how custom themes are loaded and configured
 */
import type { CustomThemeConfig } from "@/utils/themeUtils";

/**
 * Theme location configuration
 */
export interface ThemeLocationConfig {
  /**
   * List of paths to look for theme files in priority order
   * Paths can be static or derived from environment variables
   */
  themePaths: Array<string | null | undefined>;

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
  themePaths: [
    // 1. Environment variable override
    process.env.NEXT_PUBLIC_THEME_CONFIG_PATH,

    // 2. Customer-specific theme based on environment variable
    process.env.NEXT_PUBLIC_CUSTOMER_NAME
      ? `/customer-themes/${process.env.NEXT_PUBLIC_CUSTOMER_NAME}/theme.json`
      : null,

    // 3. Fallback to default location
    "/themes/custom-theme/theme.json",
  ],

  getLogoPath: (themeName, isDark) => {
    // 1. Check environment variables first
    if (isDark && process.env.NEXT_PUBLIC_LOGO_DARK_PATH) {
      return process.env.NEXT_PUBLIC_LOGO_DARK_PATH;
    }

    if (!isDark && process.env.NEXT_PUBLIC_LOGO_PATH) {
      return process.env.NEXT_PUBLIC_LOGO_PATH;
    }

    // 2. If a theme is loaded, check theme-specific paths
    if (themeName) {
      return isDark
        ? `/customer-themes/${themeName}/logo-dark.svg`
        : `/customer-themes/${themeName}/logo.svg`;
    }

    // 3. Default fallback logos
    return isDark ? "/assets/logo-dark.svg" : "/assets/logo.svg";
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
    const pathsToTry = config.themePaths.filter(Boolean) as string[];

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
