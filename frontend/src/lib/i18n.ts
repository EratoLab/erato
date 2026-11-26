import { i18n } from "@lingui/core";
import { detect, fromNavigator } from "@lingui/detect-locale";

import { env } from "@/app/env";

import { loadBundledLocaleMessages } from "./bundledLocaleMessages";

import type { FrontendPlatform } from "@/app/env";
import type { Messages } from "@lingui/core";

export const defaultLocale = "en";
export const supportedLocales = ["en", "de", "fr", "pl", "es"];

type CompiledCatalog = {
  messages: Messages;
};

type ComponentKitWithI18n = {
  name: string;
};

// Resolve a locale to a supported one, or null when it has no supported match
export function getSupportedLocale(
  locale: string | null | undefined,
): string | null {
  if (!locale) {
    return null;
  }
  // Exact match
  if (supportedLocales.includes(locale)) {
    return locale;
  }
  // Partial match on BCP-47 language tag. For example, "en-US" will match "en".
  if (locale.length > 2 && supportedLocales.includes(locale.slice(0, 2))) {
    return locale.slice(0, 2);
  }
  return null;
}

// Validate detected locale
export function getValidLocale(locale: string): string {
  return getSupportedLocale(locale) ?? defaultLocale;
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

/**
 * Loads `locale`'s catalog beside the active one without switching the
 * interface, for text said in another language than the one shown. Resolves
 * whether the catalog is there.
 */
export async function loadCatalog(locale: string): Promise<boolean> {
  const supported = getSupportedLocale(locale);
  if (!supported) return false;
  if (catalogLoaded(supported)) return true;
  const { commonPublicBasePath, frontendPlatform, frontendPublicBasePath } =
    env();
  try {
    const messages = await loadMergedMessages({
      commonPublicBasePath,
      frontendPlatform,
      frontendPublicBasePath,
      locale: supported,
    });
    if (Object.keys(messages).length === 0) return false;
    addCatalog(supported, messages);
    return true;
  } catch {
    return false;
  }
}

/** Catalogs loaded for text said in their language, beside the active one. */
const loadedCatalogs = new Set<string>();

/** For tests: no catalog counts as loaded beside the active one. */
export function forgetLoadedCatalogs() {
  loadedCatalogs.clear();
}

/** Loads `messages` as `locale`'s catalog for said text, without activating it. */
export function addCatalog(locale: string, messages: Messages) {
  i18n.load(locale, messages);
  loadedCatalogs.add(locale);
}

/**
 * Whether `locale`'s catalog can be used for said text: the active one's
 * always, another once `loadCatalog` loaded it and `inLocale` can use it.
 */
export function catalogLoaded(locale: string): boolean {
  const supported = getSupportedLocale(locale);
  if (!supported) return false;
  if (supported === getSupportedLocale(i18n.locale)) return true;
  return loadedCatalogs.has(supported) && canSwapLocale();
}

type SwappableI18n = {
  _locale: string;
  _locales: string | string[] | undefined;
};

/**
 * Lingui keeps the active locale in `_locale`. Checked once: where a Lingui
 * version keeps it elsewhere, no other catalog is used and spoken text falls
 * back to the interface language as a whole.
 */
let swapWorks: boolean | undefined;
const canSwapLocale = (): boolean => {
  if (swapWorks !== undefined) return swapWorks;
  const target = i18n as unknown as SwappableI18n;
  const previous = target._locale;
  if (typeof previous !== "string" || previous === "") return false;
  const probe = previous === "en" ? "de" : "en";
  target._locale = probe;
  swapWorks = i18n.locale === probe;
  target._locale = previous;
  return swapWorks;
};

/**
 * Runs `compose` with `locale`'s catalog, for text that is said, never shown:
 * the interface keeps its language, and nothing re-renders. `compose` must
 * be synchronous.
 */
export function inLocale<T>(locale: string, compose: () => T): T {
  const supported = getSupportedLocale(locale);
  const target = i18n as unknown as SwappableI18n;
  if (!supported || target._locale === supported || !catalogLoaded(supported))
    return compose();
  const previous = { locale: target._locale, locales: target._locales };
  target._locale = supported;
  target._locales = undefined;
  try {
    return compose();
  } finally {
    target._locale = previous.locale;
    target._locales = previous.locales;
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
  frontendPlatform: FrontendPlatform;
  frontendPublicBasePath: string;
  locale: string;
}): Promise<Messages> {
  const { themeCustomerName, themeTranslationLocales } = env();
  // All layers load at once; the order below is only the order they merge in.
  const messageLayers = await Promise.all([
    loadCommonLocaleMessages(commonPublicBasePath, locale),
    frontendPlatform !== "common"
      ? loadOptionalMessages(
          `${frontendPublicBasePath}/locales/${locale}/messages.json`,
        )
      : null,
    themeCustomerName && listedOrUnknown(themeTranslationLocales, locale)
      ? loadOptionalMessages(
          `${commonPublicBasePath}/custom-theme/${themeCustomerName}/locales/${locale}/messages.json`,
        )
      : null,
    themeCustomerName && frontendPlatform !== "common"
      ? loadOptionalMessages(
          `${frontendPublicBasePath}/custom-theme/${themeCustomerName}/locales/${locale}/messages.json`,
        )
      : null,
    loadComponentKitMessages(locale),
    loadRuntimeTranslationMessages(commonPublicBasePath, locale),
  ]);

  return messageLayers
    .flat()
    .reduce<Messages>(
      (merged, messages) => (messages ? { ...merged, ...messages } : merged),
      {},
    );
}

/** A server that lists the files it has spares the requests for missing ones;
 * without a list (an older server, the desktop package) every file is tried. */
function listedOrUnknown(
  locales: readonly string[] | null | undefined,
  locale: string,
): boolean {
  return !locales || locales.includes(locale);
}

async function loadRuntimeTranslationMessages(
  commonPublicBasePath: string,
  locale: string,
): Promise<Messages | null> {
  const listed = env().translationOverrideLocales;
  if (listed) {
    return listed.includes(locale)
      ? loadOptionalMessages(
          `${commonPublicBasePath}/overrides/${encodeURIComponent(locale)}.json`,
        )
      : null;
  }
  try {
    const indexResponse = await fetch(
      `${commonPublicBasePath}/overrides/index.json`,
    );
    if (!indexResponse.ok) {
      return null;
    }

    const index = (await indexResponse.json()) as { locales?: unknown };
    if (
      !Array.isArray(index.locales) ||
      !index.locales.every(
        (entry): entry is string => typeof entry === "string",
      ) ||
      !index.locales.includes(locale)
    ) {
      return null;
    }

    return loadOptionalMessages(
      `${commonPublicBasePath}/overrides/${encodeURIComponent(locale)}.json`,
    );
  } catch {
    return null;
  }
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

// The bundled catalog stays under the public one, which wins key by key: a
// public catalog compiled from older sources (a backend started before a pull)
// would otherwise drop every newer string to its English source text.
async function loadCommonLocaleMessages(
  commonPublicBasePath: string,
  locale: string,
): Promise<Messages> {
  const [publicMessages, bundledMessages] = await Promise.all([
    loadOptionalMessages(
      `${commonPublicBasePath}/locales/${locale}/messages.json`,
    ),
    loadBundledLocaleMessages(locale),
  ]);
  if (!publicMessages && !bundledMessages) {
    throw new Error(`No catalog for locale ${locale}`);
  }
  return { ...bundledMessages, ...publicMessages };
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
