/**
 * Lingui catalog configuration helpers for Erato.
 *
 * This module isolates the repository-specific catalog path logic from
 * `lingui.config.ts`. It defines the common exclusion rules, resolves the
 * active customer theme selection, lists available theme directories, and
 * builds the extra catalog entries for theme-localized files.
 */
import fs from "node:fs";
import path from "node:path";

/**
 * The customer component glob that should be excluded from the default catalog
 * and optionally re-included for the active theme catalog.
 */
export const CUSTOMER_COMPONENTS_GLOB = "<rootDir>/src/customer/components/**";

/**
 * Shared glob exclusions used by all frontend Lingui catalogs.
 */
export const COMMON_EXCLUDES = [
  "**/node_modules/**",
  "**/out/**",
  "**/.next/**",
  "**/test/**",
  "**/*.example.*",
];

/**
 * Resolves the explicitly selected customer theme from environment variables.
 */
function resolveExplicitCustomerThemeName(): string | null {
  const themeName =
    process.env.LINGUI_CUSTOMER_THEME ??
    process.env.VITE_CUSTOMER_NAME ??
    process.env.THEME_CUSTOMER_NAME ??
    null;

  if (!themeName || themeName.trim() === "") {
    return null;
  }

  return themeName.trim();
}

/**
 * Lists available customer theme directories in a deterministic order.
 */
function listThemeNames(rootDir: string): string[] {
  const customThemeDir = path.join(rootDir, "public", "custom-theme");
  if (!fs.existsSync(customThemeDir)) {
    return [];
  }

  return fs
    .readdirSync(customThemeDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Builds the additional Lingui catalog entries used for theme-specific
 * frontend translations.
 */
export function buildThemeCatalogs(rootDir: string) {
  const explicitCustomerTheme = resolveExplicitCustomerThemeName();

  return listThemeNames(rootDir).map((themeName) => {
    const include = [`<rootDir>/public/custom-theme/${themeName}/`];
    if (!explicitCustomerTheme || themeName === explicitCustomerTheme) {
      include.push("<rootDir>/src/customer/components/");
    }

    return {
      path: `<rootDir>/public/custom-theme/${themeName}/locales/{locale}/messages`,
      include,
      exclude: COMMON_EXCLUDES,
    };
  });
}
