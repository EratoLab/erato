import { i18n } from "@lingui/core";

export const defaultLocale = "en";
export const supportedLocales = ["en", "de", "fr"];

// Validate detected locale
export function getValidLocale(locale: string): string {
  return supportedLocales.includes(locale) ? locale : defaultLocale;
}

// Simple browser locale detection
function detectLocale(): string {
  // Deactivate for now, as it's too strongly persisted.
  // Check localStorage first
  // const stored = localStorage.getItem("locale");
  // if (stored && supportedLocales.includes(stored)) {
  //   return stored;
  // }

  // Check browser language
  const browserLang = navigator.language.split("-")[0]; // Get language code only (e.g., "en" from "en-US")
  if (supportedLocales.includes(browserLang)) {
    return browserLang;
  }

  // Fallback to default
  return defaultLocale;
}

// Dynamic catalog loading
export async function dynamicActivate(locale: string) {
  const validLocale = getValidLocale(locale);

  try {
    const { messages } = await import(`../locales/${validLocale}/messages.po`);
    i18n.loadAndActivate({
      locale: validLocale,
      messages,
    });
    // Save to localStorage for persistence
    localStorage.setItem("locale", validLocale);
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
      localStorage.setItem("locale", defaultLocale);
    }
  }
}

// Initialize with detected locale
export function initializeI18n() {
  const detectedLocale = detectLocale();
  return dynamicActivate(detectedLocale);
}

export { i18n };
