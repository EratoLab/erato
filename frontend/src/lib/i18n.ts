import { i18n } from "@lingui/core";
import { detect, fromNavigator } from "@lingui/detect-locale";

import { env } from "@/app/env";

import type { Messages } from "@lingui/core";

export const defaultLocale = "en";
export const supportedLocales = ["en", "de", "fr", "pl", "es"];

type CompiledCatalog = {
  messages: Messages;
};

type ComponentKitWithI18n = {
  name: string;
};

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
  const { commonPublicBasePath, frontendPlatform, frontendPublicBasePath } =
    env();

  try {
    const mergedMessages = await loadMergedMessages({
      commonPublicBasePath,
      frontendPlatform,
      frontendPublicBasePath,
      locale: validLocale,
    });

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
      const { commonPublicBasePath, frontendPlatform, frontendPublicBasePath } =
        env();
      const messages = await loadMergedMessages({
        commonPublicBasePath,
        frontendPlatform,
        frontendPublicBasePath,
        locale: defaultLocale,
      });
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

async function loadMergedMessages({
  commonPublicBasePath,
  frontendPlatform,
  frontendPublicBasePath,
  locale,
}: {
  commonPublicBasePath: string;
  frontendPlatform: "common" | "platform-office-addin";
  frontendPublicBasePath: string;
  locale: string;
}): Promise<Messages> {
  const themeCustomerName = env().themeCustomerName;
  const messageLayers = [
    await loadCommonLocaleMessages(commonPublicBasePath, locale),
    frontendPlatform !== "common"
      ? await loadOptionalMessages(
          `${frontendPublicBasePath}/locales/${locale}/messages.json`,
        )
      : null,
    ...(themeCustomerName
      ? [
          await loadOptionalMessages(
            `${commonPublicBasePath}/custom-theme/${themeCustomerName}/locales/${locale}/messages.json`,
          ),
          frontendPlatform !== "common"
            ? await loadOptionalMessages(
                `${frontendPublicBasePath}/custom-theme/${themeCustomerName}/locales/${locale}/messages.json`,
              )
            : null,
        ]
      : []),
    ...(await loadComponentKitMessages(locale)),
  ];

  return messageLayers.reduce<Messages>(
    (merged, messages) => (messages ? { ...merged, ...messages } : merged),
    {},
  );
}

function getRegisteredComponentKitNames(): string[] {
  if (typeof window === "undefined") {
    return [];
  }

  const componentKits = (
    window as Window & {
      ERATO_COMPONENT_KITS?: ComponentKitWithI18n[];
    }
  ).ERATO_COMPONENT_KITS;

  return Array.from(
    new Set(
      (componentKits ?? [])
        .map((componentKit) => componentKit.name)
        .filter((name) => name.length > 0),
    ),
  );
}

async function loadComponentKitMessages(locale: string): Promise<Messages[]> {
  const componentKitNames = getRegisteredComponentKitNames();
  if (componentKitNames.length === 0) {
    return [];
  }

  const messageLayers = await Promise.all(
    componentKitNames.map((componentKitName) =>
      loadOptionalMessages(
        `/public/component-kits/${encodeURIComponent(componentKitName)}/locales/${locale}/messages.json`,
      ),
    ),
  );

  return messageLayers.filter((messages): messages is Messages => !!messages);
}

async function loadCommonLocaleMessages(
  commonPublicBasePath: string,
  locale: string,
): Promise<Messages> {
  const publicMessages = await loadOptionalMessages(
    `${commonPublicBasePath}/locales/${locale}/messages.json`,
  );
  if (publicMessages) {
    return publicMessages;
  }

  const bundledMessages = await import(`../locales/${locale}/messages.po`);
  return bundledMessages.messages;
}

async function loadOptionalMessages(url: string): Promise<Messages | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }

    const { messages } = (await response.json()) as CompiledCatalog;
    return messages;
  } catch {
    return null;
  }
}
