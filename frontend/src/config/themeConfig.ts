/**
 * Theme Configuration
 * Defines how custom themes are loaded and configured
 */
import { env } from "@/app/env";
import { debugLog } from "@/utils/debugLogger";

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
  basePath: string,
  customerName: string | null | undefined,
  filename: string,
) =>
  customerName ? `${basePath}/custom-theme/${customerName}/${filename}` : null;

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
  platformPublicBasePath: string;
  commonPublicBasePath: string;
  themePath?: string | null;
  customerName?: string | null;
  themeCustomerName?: string | null;
  preferPlatformBaseDir?: boolean;
}): string => {
  const {
    commonPublicBasePath,
    customerName,
    platformPublicBasePath,
    preferPlatformBaseDir = false,
    themeCustomerName,
    themePath,
  } = options;

  if (themePath) return themePath;
  if (customerName) {
    return `${preferPlatformBaseDir ? platformPublicBasePath : commonPublicBasePath}/custom-theme/${customerName}`;
  }
  if (themeCustomerName) {
    return `${preferPlatformBaseDir ? platformPublicBasePath : commonPublicBasePath}/custom-theme/${themeCustomerName}`;
  }

  return `${preferPlatformBaseDir ? platformPublicBasePath : commonPublicBasePath}/custom-theme`;
};

const resolveThemeFilePath = (options: {
  platformPublicBasePath: string;
  commonPublicBasePath: string;
  filename: string;
  themePath?: string | null;
  customerName?: string | null;
  themeCustomerName?: string | null;
  defaultPath?: string | null;
}): string | null => {
  const {
    commonPublicBasePath,
    filename,
    platformPublicBasePath,
    themePath,
    customerName,
    themeCustomerName,
    defaultPath = `${commonPublicBasePath}/custom-theme/${filename}`,
  } = options;

  return (
    buildThemePathOverride(themePath ?? undefined, filename) ??
    buildCustomerThemeFilePath(
      platformPublicBasePath,
      customerName ?? undefined,
      filename,
    ) ??
    buildCustomerThemeFilePath(
      commonPublicBasePath,
      customerName ?? undefined,
      filename,
    ) ??
    buildCustomerThemeFilePath(
      platformPublicBasePath,
      themeCustomerName ?? undefined,
      filename,
    ) ??
    buildCustomerThemeFilePath(
      commonPublicBasePath,
      themeCustomerName ?? undefined,
      filename,
    ) ??
    defaultPath
  );
};

const resolveThemePackAssetPath = (options: {
  platformPublicBasePath: string;
  commonPublicBasePath: string;
  filename: string;
  resolvedThemeConfigPath?: string | null;
  themeConfigPath?: string | null;
  themePath?: string | null;
  customerName?: string | null;
  themeCustomerName?: string | null;
  defaultPath?: string | null;
}): string | null => {
  const {
    commonPublicBasePath,
    filename,
    platformPublicBasePath,
    resolvedThemeConfigPath,
    themeConfigPath,
    themePath,
    customerName,
    themeCustomerName,
    defaultPath = `${commonPublicBasePath}/custom-theme/${filename}`,
  } = options;

  if (resolvedThemeConfigPath) {
    return resolveSiblingThemeFilePath(resolvedThemeConfigPath, filename);
  }

  if (themeConfigPath) {
    return resolveSiblingThemeFilePath(themeConfigPath, filename);
  }

  return resolveThemeFilePath({
    commonPublicBasePath,
    filename,
    platformPublicBasePath,
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
  const {
    commonPublicBasePath,
    frontendPublicBasePath,
    themePath,
    themeCustomerName,
  } = env();

  // 1. Environment variable override
  const envPath = isDark ? envPaths.dark : envPaths.light;
  if (envPath) return envPath;

  const filename = buildThemeAssetFilename(baseFilename, isDark);
  return resolveThemeFilePath({
    commonPublicBasePath,
    filename,
    platformPublicBasePath: frontendPublicBasePath,
    themePath,
    themeCustomerName,
    defaultPath: hasDefault
      ? `${commonPublicBasePath}/custom-theme/${filename}`
      : null,
  });
};

/**
 * Default theme configuration
 */
export const defaultThemeConfig: ThemeLocationConfig = {
  getThemePaths: () => {
    const {
      commonPublicBasePath,
      frontendPublicBasePath,
      themeConfigPath,
      themeCustomerName,
      themePath,
    } = env();

    const paths: Array<string | null | undefined> = [
      // 1. Environment variable override for entire path
      themeConfigPath,
    ];

    if (frontendPublicBasePath !== commonPublicBasePath) {
      paths.push(
        buildCustomerThemeFilePath(
          frontendPublicBasePath,
          themeCustomerName,
          "theme.json",
        ),
      );
    }

    paths.push(
      // 2. Shared common theme
      buildCustomerThemeFilePath(
        commonPublicBasePath,
        themeCustomerName,
        "theme.json",
      ),
      // 3. Custom theme override path
      buildThemePathOverride(themePath, "theme.json"),
    );

    if (frontendPublicBasePath !== commonPublicBasePath) {
      paths.push(`${frontendPublicBasePath}/custom-theme/theme.json`);
    }

    paths.push(`${commonPublicBasePath}/custom-theme/theme.json`);

    return paths;
  },

  getLogoPath: (themeName, isDark) => {
    const path = resolveAssetPath({
      envPaths: { light: env().themeLogoPath, dark: env().themeLogoDarkPath },
      baseFilename: "logo",
      isDark,
      hasDefault: true,
    });
    // Logo always has a default, so path will never be null
    return path ?? `${env().commonPublicBasePath}/custom-theme/logo.svg`;
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
    const {
      commonPublicBasePath,
      frontendPublicBasePath,
      themeConfigPath,
      themePath,
      themeCustomerName,
    } = env();
    return (
      resolveThemePackAssetPath({
        commonPublicBasePath,
        filename: "fonts.css",
        platformPublicBasePath: frontendPublicBasePath,
        resolvedThemeConfigPath,
        themeConfigPath,
        themePath,
        themeCustomerName,
        defaultPath: `${commonPublicBasePath}/custom-theme/fonts.css`,
      }) ?? `${commonPublicBasePath}/custom-theme/fonts.css`
    );
  },

  getThemeCssPath: (themeName, resolvedThemeConfigPath) => {
    const {
      commonPublicBasePath,
      frontendPublicBasePath,
      themeConfigPath,
      themePath,
      themeCustomerName,
    } = env();
    return (
      resolveThemePackAssetPath({
        commonPublicBasePath,
        filename: "theme.css",
        platformPublicBasePath: frontendPublicBasePath,
        resolvedThemeConfigPath,
        themeConfigPath,
        themePath,
        themeCustomerName,
        defaultPath: `${commonPublicBasePath}/custom-theme/theme.css`,
      }) ?? `${commonPublicBasePath}/custom-theme/theme.css`
    );
  },
};

export interface LoadedThemeConfig {
  themeConfig: CustomThemeConfig;
  themeConfigPath: string;
}

/**
 * A theme the environment explicitly asked for, plus a predicate that says
 * whether a resolved theme.json path actually satisfies that request.
 *
 * `getThemePaths()` always ends with generic fall-back locations, so a
 * misconfigured request resolves to *some* theme rather than failing. These
 * descriptors let us tell "the requested theme loaded" apart from "we silently
 * loaded a different one".
 */
interface RequestedTheme {
  label: string;
  matches: (path: string) => boolean;
}

const describeRequestedThemes = (): RequestedTheme[] => {
  const { themeConfigPath, themeCustomerName, themePath } = env();
  const requests: RequestedTheme[] = [];

  if (themeConfigPath) {
    requests.push({
      label: `themeConfigPath "${themeConfigPath}"`,
      matches: (path) => path === themeConfigPath,
    });
  }
  if (themePath) {
    requests.push({
      label: `themePath "${themePath}"`,
      matches: (path) => path === `${themePath}/theme.json`,
    });
  }
  if (themeCustomerName) {
    requests.push({
      label: `customer name "${themeCustomerName}"`,
      matches: (path) =>
        path.endsWith(`/custom-theme/${themeCustomerName}/theme.json`),
    });
  }

  return requests;
};

export async function loadResolvedThemeConfig(
  config: ThemeLocationConfig = defaultThemeConfig,
): Promise<LoadedThemeConfig | null> {
  try {
    const requests = describeRequestedThemes();
    const requestedLabel = requests.length
      ? requests.map((request) => request.label).join(", ")
      : "none";
    const pathsToTry = config.getThemePaths().filter(Boolean) as string[];

    for (const path of pathsToTry) {
      try {
        const response = await fetch(path);
        if (response.ok) {
          const themeConfig = (await response.json()) as CustomThemeConfig;
          console.log(
            `Custom theme loaded: ${themeConfig.name} from ${path} (requested: ${requestedLabel})`,
          );
          if (
            requests.length > 0 &&
            !requests.some((request) => request.matches(path))
          ) {
            console.warn(
              `Requested theme (${requestedLabel}) was not found. Loaded "${themeConfig.name}" from the fallback location ${path} instead. Check the theme configuration and that the theme pack is deployed.`,
            );
          }
          return {
            themeConfig,
            themeConfigPath: path,
          };
        }
        debugLog(
          "UI",
          `Theme not found at ${path} (HTTP ${response.status}), trying next location`,
        );
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (error) {
        debugLog("UI", `Theme not found at ${path}, trying next location`);
      }
    }

    if (requests.length > 0) {
      console.warn(
        `Requested theme (${requestedLabel}) was not found at any location; falling back to the built-in default theme. Tried: ${pathsToTry.join(", ")}`,
      );
    }
    debugLog("UI", "No custom theme found, using default theme");
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

  const {
    commonPublicBasePath,
    frontendPlatform,
    frontendPublicBasePath,
    themePath,
    themeCustomerName,
  } = env();

  // Determine base path for custom icons
  // Priority: themePath > customerName > themeCustomerName > default
  const basePath = resolveThemeBaseDir({
    commonPublicBasePath,
    platformPublicBasePath: frontendPublicBasePath,
    preferPlatformBaseDir: frontendPlatform !== "common",
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
