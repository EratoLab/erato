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

  /**
   * Function to determine fonts.css path for custom theme fonts
   * @param themeName The name of the loaded theme
   * @param resolvedThemeConfigPath The resolved theme.json path, when known
   * @returns Path to the fonts.css file, or null if not available
   */
  getFontsCssPath: (
    themeName: string | undefined,
    resolvedThemeConfigPath?: string | null,
  ) => string | null;

  /**
   * Function to determine theme.css path for custom theme shell overrides
   * @param themeName The name of the loaded theme
   * @param resolvedThemeConfigPath The resolved theme.json path, when known
   * @returns Path to the theme.css file, or null if not available
   */
  getThemeCssPath: (
    themeName: string | undefined,
    resolvedThemeConfigPath?: string | null,
  ) => string | null;
}

const buildThemeAssetFilename = (baseFilename: string, isDark: boolean) =>
  `${baseFilename}${isDark ? "-dark" : ""}.svg`;

const buildCustomerThemeFilePath = (
  customerName: string | null | undefined,
  filename: string,
) => (customerName ? `/custom-theme/${customerName}/${filename}` : null);

const buildThemePathOverride = (
  themePath: string | null | undefined,
  filename: string,
) => (themePath ? `${themePath}/${filename}` : null);

const resolveSiblingThemeFilePath = (
  themeConfigPath: string,
  filename: string,
): string => {
  const sanitizedThemeConfigPath = themeConfigPath.replace(/[?#].*$/, "");
  const lastSlashIndex = sanitizedThemeConfigPath.lastIndexOf("/");

  if (lastSlashIndex === -1) return filename;
  if (lastSlashIndex === 0) return `/${filename}`;

  return `${sanitizedThemeConfigPath.slice(0, lastSlashIndex)}/${filename}`;
};

const resolveThemeBaseDir = (options: {
  themePath?: string | null;
  customerName?: string | null;
  themeCustomerName?: string | null;
  defaultDir?: string;
}): string => {
  const { themePath, customerName, themeCustomerName, defaultDir } = options;

  if (themePath) return themePath;
  if (customerName) return `/custom-theme/${customerName}`;
  if (themeCustomerName) return `/custom-theme/${themeCustomerName}`;

  return defaultDir ?? "/custom-theme";
};

const resolveThemeFilePath = (options: {
  filename: string;
  themePath?: string | null;
  customerName?: string | null;
  themeCustomerName?: string | null;
  defaultPath?: string | null;
}): string | null => {
  const {
    filename,
    themePath,
    customerName,
    themeCustomerName,
    defaultPath = `/custom-theme/${filename}`,
  } = options;

  return (
    buildThemePathOverride(themePath ?? undefined, filename) ??
    buildCustomerThemeFilePath(customerName ?? undefined, filename) ??
    buildCustomerThemeFilePath(themeCustomerName ?? undefined, filename) ??
    defaultPath
  );
};

const resolveThemePackAssetPath = (options: {
  filename: string;
  resolvedThemeConfigPath?: string | null;
  themeConfigPath?: string | null;
  themePath?: string | null;
  customerName?: string | null;
  themeCustomerName?: string | null;
  defaultPath?: string | null;
}): string | null => {
  const {
    filename,
    resolvedThemeConfigPath,
    themeConfigPath,
    themePath,
    customerName,
    themeCustomerName,
    defaultPath = `/custom-theme/${filename}`,
  } = options;

  if (resolvedThemeConfigPath) {
    return resolveSiblingThemeFilePath(resolvedThemeConfigPath, filename);
  }

  if (themeConfigPath) {
    return resolveSiblingThemeFilePath(themeConfigPath, filename);
  }

  return resolveThemeFilePath({
    filename,
    themePath,
    customerName,
    themeCustomerName,
    defaultPath,
  });
};

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

  const filename = buildThemeAssetFilename(baseFilename, isDark);
  return resolveThemeFilePath({
    filename,
    themePath,
    themeCustomerName,
    defaultPath: hasDefault ? `/custom-theme/${filename}` : null,
  });
};

/**
 * Default theme configuration
 */
export const defaultThemeConfig: ThemeLocationConfig = {
  getThemePaths: () => {
    const { themeConfigPath, themeCustomerName, themePath } = env();

    return [
      // 1. Environment variable override for entire path
      themeConfigPath,

      // 2. Customer-specific theme based on environment variable
      buildCustomerThemeFilePath(themeCustomerName, "theme.json"),

      // 3. Custom theme override path
      buildThemePathOverride(themePath, "theme.json"),

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

  getFontsCssPath: (themeName, resolvedThemeConfigPath) => {
    const { themeConfigPath, themePath, themeCustomerName } = env();
    return (
      resolveThemePackAssetPath({
        filename: "fonts.css",
        resolvedThemeConfigPath,
        themeConfigPath,
        themePath,
        themeCustomerName,
        defaultPath: "/custom-theme/fonts.css",
      }) ?? "/custom-theme/fonts.css"
    );
  },

  getThemeCssPath: (themeName, resolvedThemeConfigPath) => {
    const { themeConfigPath, themePath, themeCustomerName } = env();
    return (
      resolveThemePackAssetPath({
        filename: "theme.css",
        resolvedThemeConfigPath,
        themeConfigPath,
        themePath,
        themeCustomerName,
        defaultPath: "/custom-theme/theme.css",
      }) ?? "/custom-theme/theme.css"
    );
  },
};

export interface LoadedThemeConfig {
  themeConfig: CustomThemeConfig;
  themeConfigPath: string;
}

export async function loadResolvedThemeConfig(
  config: ThemeLocationConfig = defaultThemeConfig,
): Promise<LoadedThemeConfig | null> {
  try {
    const pathsToTry = config.getThemePaths().filter(Boolean) as string[];

    for (const path of pathsToTry) {
      try {
        const response = await fetch(path);
        if (response.ok) {
          const themeConfig = (await response.json()) as CustomThemeConfig;
          console.log(`Custom theme loaded: ${themeConfig.name} from ${path}`);
          return {
            themeConfig,
            themeConfigPath: path,
          };
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

/**
 * Loads a theme from the configured theme paths
 * @param config Theme location configuration
 * @returns The loaded theme config or null if no theme was found
 */
export async function loadThemeConfig(
  config: ThemeLocationConfig = defaultThemeConfig,
): Promise<CustomThemeConfig | null> {
  const loadedThemeConfig = await loadResolvedThemeConfig(config);
  return loadedThemeConfig?.themeConfig ?? null;
}

/**
 * Resolves relative icon paths to absolute paths
 * @param iconMappings Raw icon mappings from theme.json
 * @param customerName Theme customer name for path resolution
 * @returns Icon mappings with resolved absolute paths
 */
export function resolveIconPaths(
  iconMappings:
    | {
        fileTypes?: Record<string, string>;
        status?: Record<string, string>;
        actions?: Record<string, string>;
        navigation?: Record<string, string>;
      }
    | undefined,
  customerName: string | undefined,
): {
  fileTypes?: Record<string, string>;
  status?: Record<string, string>;
  actions?: Record<string, string>;
  navigation?: Record<string, string>;
} {
  if (!iconMappings) return {};

  const { themePath, themeCustomerName } = env();

  // Determine base path for custom icons
  // Priority: themePath > customerName > themeCustomerName > default
  const basePath = resolveThemeBaseDir({
    themePath,
    customerName,
    themeCustomerName,
  });

  // Helper function to resolve a single icon value
  const resolveIconValue = (iconValue: string): string => {
    // If it starts with ./ it's a relative path that needs resolution
    if (iconValue.startsWith("./")) {
      // Remove the ./ prefix and prepend the base path
      return `${basePath}/${iconValue.slice(2)}`;
    }
    // If it starts with / it's already an absolute path
    if (iconValue.startsWith("/")) {
      return iconValue;
    }
    // Otherwise it's an icon name from iconoir-react, keep as-is
    return iconValue;
  };

  // Helper function to resolve a category of icon mappings
  const resolveCategory = (
    category: Record<string, string> | undefined,
  ): Record<string, string> | undefined => {
    if (!category) return undefined;

    const resolved: Record<string, string> = {};
    for (const [key, value] of Object.entries(category)) {
      resolved[key] = resolveIconValue(value);
    }
    return resolved;
  };

  // Resolve all categories
  return {
    fileTypes: resolveCategory(iconMappings.fileTypes),
    status: resolveCategory(iconMappings.status),
    actions: resolveCategory(iconMappings.actions),
    navigation: resolveCategory(iconMappings.navigation),
  };
}
