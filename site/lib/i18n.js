/**
 * Internationalization utilities for the erato.chat website
 *
 * LOCALE POLICY:
 * - Marketing pages (homepage, etc.) are localized in English and German
 * - Documentation pages (/docs/*) are English-only for the foreseeable future
 * - When accessing /de/docs/* routes, users will see English content with
 *   the /de/ URL prefix preserved (transparent fallback)
 */

export const defaultLocale = "en";
export const supportedLocales = ["en", "de"];

/**
 * Detects the preferred locale from Accept-Language header or browser settings
 * @param {string} acceptLanguage - Accept-Language header value
 * @returns {string} Valid locale code
 */
export function detectLocale(acceptLanguage) {
  if (!acceptLanguage) {
    return defaultLocale;
  }

  // Parse Accept-Language header
  const languages = acceptLanguage
    .split(",")
    .map((lang) => {
      const [locale, q = "1"] = lang.trim().split(";q=");
      return { locale: locale.toLowerCase(), quality: parseFloat(q) };
    })
    .sort((a, b) => b.quality - a.quality);

  // Find first supported locale
  for (const { locale } of languages) {
    // Check exact match
    if (supportedLocales.includes(locale)) {
      return locale;
    }
    // Check language code match (e.g., "de-DE" -> "de")
    const langCode = locale.split("-")[0];
    if (supportedLocales.includes(langCode)) {
      return langCode;
    }
  }

  return defaultLocale;
}

/**
 * Validates and normalizes a locale code
 * @param {string} locale - Locale code to validate
 * @returns {string} Valid locale code
 */
export function getValidLocale(locale) {
  if (supportedLocales.includes(locale)) {
    return locale;
  }
  return defaultLocale;
}

/**
 * Gets the locale from URL path
 * @param {string} pathname - Current pathname
 * @returns {string} Locale code or null if root path
 */
export function getLocaleFromPath(pathname) {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length > 0 && supportedLocales.includes(segments[0])) {
    return segments[0];
  }
  return defaultLocale;
}

/**
 * Gets the path without locale prefix
 * @param {string} pathname - Current pathname
 * @returns {string} Path without locale prefix
 */
export function getPathWithoutLocale(pathname) {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length > 0 && supportedLocales.includes(segments[0])) {
    return "/" + segments.slice(1).join("/");
  }
  return pathname || "/";
}

/**
 * Adds locale prefix to path
 * @param {string} pathname - Path to prefix
 * @param {string} locale - Locale code
 * @returns {string} Path with locale prefix
 */
export function addLocaleToPath(pathname, locale) {
  if (locale === defaultLocale) {
    return pathname || "/";
  }
  const cleanPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `/${locale}${cleanPath === "/" ? "" : cleanPath}`;
}
