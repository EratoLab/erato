import { dynamicActivate, getSupportedLocale } from "@erato/frontend/library";

/**
 * Switches the UI to the host application's display language (Office's
 * `Office.context.displayLanguage`, Teams' `app.locale`).
 *
 * `navigator.language` inside a task pane or tab reflects the OS or browser,
 * not the host's own language setting, so the host value takes precedence.
 * An absent or unsupported host language leaves the browser-detected locale
 * that `I18nProvider` already activated in place, and failures are swallowed:
 * the language must never block the host from finishing its startup.
 */
export async function activateHostLocale(
  hostLocale: string | null | undefined,
): Promise<void> {
  const locale = getSupportedLocale(hostLocale);
  if (!locale) {
    return;
  }
  try {
    await dynamicActivate(locale);
  } catch (error) {
    console.warn("Failed to activate host display language", error);
  }
}
