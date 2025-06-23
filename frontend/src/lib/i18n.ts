import { i18n } from "@lingui/core";
import { detect, fromNavigator } from "@lingui/detect-locale";

import { env } from "@/app/env";

export const defaultLocale = "en";
export const supportedLocales = ["en", "de", "fr", "pl", "es"];

// Validate detected locale
export function getValidLocale(locale: string): string {
  // Exact match
  if (supportedLocales.includes(locale)) {
    return locale;
  }
  // Partial match on BCP-47 language tag. For example, "en-US" will match "en".
  else if (locale.length > 2 && supportedLocales.includes(locale.slice(0, 2))) {
    return locale.slice(0, 2);
  }
  // Fallback
  else {
    return defaultLocale;
  }
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
    // Load main locale messages
    const { messages: mainMessages } = await import(
      `../locales/${validLocale}/messages.po`
    );

    // Try to load custom-theme translations and merge them
    let customThemePath: string | null = null;
    try {
      customThemePath = env().themeCustomerName;
    } catch {
      // Environment not fully configured, skip custom theme loading
    }
    let mergedMessages = mainMessages;

    if (customThemePath) {
      try {
        const themeUrl = `/custom-theme/${customThemePath}/locales/${validLocale}/messages.json`;
        const response = await fetch(themeUrl);
        if (response.ok) {
          const { messages: customMessages } = await response.json();
          // Merge custom theme messages with main messages
          // Custom theme messages take precedence for overlapping keys
          mergedMessages = { ...mainMessages, ...customMessages };
        }
      } catch (error) {
        console.warn(
          `[i18n] Failed to load custom theme locale ${validLocale}, using main translations only.`,
          error,
        );
        // Continue with main messages only
      }
    }

    i18n.loadAndActivate({
      locale: validLocale,
      messages: mergedMessages,
    });
    // Note: No localStorage persistence - locale only active for current session
  } catch (error) {
    console.error(
      `[i18n] Failed to load locale ${validLocale}, falling back to ${defaultLocale}`,
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
