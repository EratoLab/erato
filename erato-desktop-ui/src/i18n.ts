import { i18n } from "@lingui/core";

import { messages as de } from "./locales/de/messages.po";
import { messages as en } from "./locales/en/messages.po";
import { messages as es } from "./locales/es/messages.po";
import { messages as fr } from "./locales/fr/messages.po";
import { messages as pl } from "./locales/pl/messages.po";

export const DEFAULT_LOCALE = "en";

// Every catalog is compiled into the bundle and loaded up front: the webview
// has no network and no dynamic import, so activation is synchronous.
const CATALOGS = { en, de, fr, pl, es } as const;

export const SUPPORTED_LOCALES = Object.keys(CATALOGS);

/** The bundled locale for a BCP-47 tag (`de-AT` → `de`), or `en`. */
export function resolveLocale(locale: string | undefined): string {
  if (!locale) return DEFAULT_LOCALE;
  const language = locale.toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_LOCALES.includes(language) ? language : DEFAULT_LOCALE;
}

export function activateLocale(locale: string | undefined): string {
  const resolved = resolveLocale(locale);
  i18n.load(CATALOGS);
  i18n.activate(resolved);
  return resolved;
}

export { i18n };
