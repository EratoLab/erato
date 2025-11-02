import { importPage } from "nextra/pages";
import { defaultLocale } from "./i18n.js";

/**
 * Resolves content with locale fallback
 * Tries locale-specific content first, falls back to English if not found
 * 
 * IMPORTANT: Documentation pages (under /docs/) are English-only for the foreseeable future.
 * This means that when accessing /de/docs/* routes, users will see English content
 * but with the /de/ URL prefix preserved. This is intentional behavior - only marketing
 * pages (homepage, etc.) are planned for localization.
 * 
 * @param {string[]} mdxPath - MDX path segments
 * @param {string} locale - Locale code
 * @returns {Promise<{default: Component, toc: any, metadata: any, actualLocale: string}>}
 */
export async function resolveContentWithFallback(mdxPath, locale) {
  if (locale === defaultLocale) {
    // For English, use standard path
    const result = await importPage(mdxPath);
    return { ...result, actualLocale: defaultLocale };
  }

  // Try locale-specific content first
  const localePath = [locale, ...mdxPath];
  try {
    const result = await importPage(localePath);
    // Check if the file actually exists by verifying metadata filePath
    // The filePath should start with "content/{locale}/" for locale-specific content
    if (result.metadata?.filePath && result.metadata.filePath.startsWith(`content/${locale}/`)) {
      return { ...result, actualLocale: locale };
    }
    // If filePath doesn't match, it might be a fallback, so continue to English fallback
  } catch (error) {
    // Content doesn't exist, fall through to fallback
    // Log error in development for debugging
    if (process.env.NODE_ENV === 'development') {
      console.debug(`[i18n] Locale-specific content not found for path [${localePath.join(', ')}], falling back to English`);
    }
  }

  // Fallback to English content
  try {
    const result = await importPage(mdxPath);
    return { ...result, actualLocale: defaultLocale };
  } catch (error) {
    // Re-throw if English content also doesn't exist
    console.error(`[i18n] Failed to load content for path [${mdxPath.join(', ')}]:`, error);
    throw error;
  }
}

/**
 * Resolves content path for a given locale
 * Returns the path that should be used to load content
 * @param {string[]} mdxPath - MDX path segments
 * @param {string} locale - Locale code
 * @returns {Promise<{path: string[], actualLocale: string}>}
 */
export async function resolveContentPath(mdxPath, locale) {
  if (locale === defaultLocale) {
    return { path: mdxPath, actualLocale: defaultLocale };
  }

  // Try locale-specific content first
  const localePath = [locale, ...mdxPath];
  try {
    const result = await importPage(localePath);
    if (result.metadata?.filePath) {
      return { path: localePath, actualLocale: locale };
    }
  } catch (error) {
    // Content doesn't exist, fall through to fallback
  }

  // Fallback to English content
  return { path: mdxPath, actualLocale: defaultLocale };
}

