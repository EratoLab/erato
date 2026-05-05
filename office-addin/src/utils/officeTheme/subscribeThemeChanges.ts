import { callOfficeAsync } from "../officeAsync";
import { detectTheme, type OfficeThemeSnapshot } from "./detectTheme";

/**
 * Subscribes to Office theme changes. Returns an unsubscribe function.
 *
 * Two signals are layered:
 *
 * 1. `Office.EventType.OfficeThemeChanged` on the Outlook mailbox (Mailbox
 *    requirement set 1.14). Fires reliably on OWA. Fires unreliably with
 *    stale payload on Outlook for Windows / Mac — see
 *    https://github.com/OfficeDev/office-js/issues/6348.
 *
 * 2. `prefers-color-scheme` media query. Reflects the OS dark-mode preference
 *    and fires immediately even when Outlook's `officeTheme` cache is stale
 *    (Win32 bug above). We only honour it when the initial Office theme and
 *    the OS preference *agree* — that's our heuristic for "user picked
 *    `Use System Settings` in Outlook", in which case OS theme changes
 *    should propagate. If they disagree at startup the user is in an
 *    explicit Outlook theme (Black / Dark Grey / White / Colorful), and we
 *    leave matchMedia alone to avoid flipping their addin against their
 *    explicit choice.
 *
 * Other hosts: no-op. Excel / Word / PowerPoint don't expose a theme-change
 * event in `@types/office-js@1.0.581`.
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

  const unsubscribeMatchMedia = subscribeSystemColorScheme(host, handler);

  return () => {
    unsubscribeMatchMedia();
    callOfficeAsync<void>((callback) => {
      mailbox.removeHandlerAsync(Office.EventType.OfficeThemeChanged, callback);
    }).catch((err: unknown) => {
      console.warn("[officeTheme] failed to remove theme-change handler", err);
    });
  };
}

/**
 * Installs a `prefers-color-scheme` listener as a fallback refresh signal.
 * See `subscribeThemeChanges` for the agreement heuristic that gates this.
 */
function subscribeSystemColorScheme(
  host: string,
  handler: (snapshot: OfficeThemeSnapshot) => void,
): () => void {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return () => {};
  }

  const initial = detectTheme(host);
  if (!initial) return () => {};

  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const matchMediaIsDark = mq.matches;
  const officeIsDark = initial.mode === "dark";

  if (matchMediaIsDark !== officeIsDark) {
    // User has an explicit Outlook theme — leave matchMedia alone.
    return () => {};
  }

  const onChange = (event: MediaQueryListEvent) => {
    const latest = detectTheme(host);
    if (!latest) return;
    const nextMode: "light" | "dark" = event.matches ? "dark" : "light";
    if (nextMode === latest.mode) return;
    // `latest.colors` may be stale on Win32 (the whole reason this fallback
    // exists), but consumers use `mode` for theme switching, not `colors`.
    handler({ mode: nextMode, colors: latest.colors });
  };

  mq.addEventListener("change", onChange);
  return () => {
    mq.removeEventListener("change", onChange);
  };
}
