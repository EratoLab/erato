import { i18n } from "@lingui/core";
import { detect, fromNavigator } from "@lingui/detect-locale";

export const defaultLocale = "en";
export const supportedLocales = ["en", "de", "fr"];

// Validate detected locale
export function getValidLocale(locale: string): string {
  return supportedLocales.includes(locale) ? locale : defaultLocale;
}

// Browser locale detection without persistence
function detectLocale(): string {
  // Use Lingui's detect with browser-only strategies:
  // 1. browser language (navigator.language)
  // 2. fallback to default
  const detectedLocale = detect(
    fromNavigator(), // Check browser language
    () => defaultLocale, // Fallback
  );

  // Validate the detected locale against our supported locales
  // detect() can return null, so we handle that case
  return getValidLocale(detectedLocale ?? defaultLocale);
}

// Dynamic catalog loading (session-only, no persistence)
export async function dynamicActivate(locale: string) {
  const validLocale = getValidLocale(locale);

  try {
    const { messages } = await import(`../locales/${validLocale}/messages.po`);
    i18n.loadAndActivate({
      locale: validLocale,
      messages,
    });
    // Note: No localStorage persistence - locale only active for current session
  } catch (error) {
    console.warn(
      `Failed to load locale ${validLocale}, falling back to ${defaultLocale}`,
      error,
    );
    if (validLocale !== defaultLocale) {
      const { messages } = await import(
        `../locales/${defaultLocale}/messages.po`
      );
      i18n.loadAndActivate({
        locale: defaultLocale,
        messages,
      });
    }
  }
}

// Initialize with detected locale
export function initializeI18n() {
  const detectedLocale = detectLocale();
  return dynamicActivate(detectedLocale);
}

// Export detection function for testing
export { detectLocale };

export { i18n };
