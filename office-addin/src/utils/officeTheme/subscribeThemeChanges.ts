import { callOfficeAsync } from "../officeAsync";
import { detectTheme, type OfficeThemeSnapshot } from "./detectTheme";

/**
 * Subscribes to Office theme changes. Returns an unsubscribe function.
 *
 * Only Outlook exposes an event in `@types/office-js@1.0.581` — other hosts
 * fall back to a no-op unsubscribe. The handler receives a parsed
 * `OfficeThemeSnapshot` so callers never touch the raw event args.
 */
export function subscribeThemeChanges(
  host: string | null,
  handler: (snapshot: OfficeThemeSnapshot) => void,
): () => void {
  if (host !== "Outlook") {
    console.debug(
      `[officeTheme] subscribeThemeChanges: no-op for host "${host ?? "null"}" — ` +
        "no theme-change event surface available in @types/office-js",
    );
    return () => {};
  }

  const mailbox =
    typeof Office !== "undefined" ? Office?.context?.mailbox : undefined;
  if (!mailbox) {
    return () => {};
  }

  const eventHandler = () => {
    const snapshot = detectTheme(host);
    if (snapshot) {
      handler(snapshot);
    }
  };

  callOfficeAsync<void>((callback) => {
    mailbox.addHandlerAsync(
      Office.EventType.OfficeThemeChanged,
      eventHandler,
      callback,
    );
  }).catch((err: unknown) => {
    console.warn("[officeTheme] failed to register theme-change handler", err);
  });

  return () => {
    callOfficeAsync<void>((callback) => {
      mailbox.removeHandlerAsync(Office.EventType.OfficeThemeChanged, callback);
    }).catch((err: unknown) => {
      console.warn("[officeTheme] failed to remove theme-change handler", err);
    });
  };
}
