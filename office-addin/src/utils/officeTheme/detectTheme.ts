import { isHexDark } from "./luminance";

export type OfficeThemeSnapshot = {
  mode: "light" | "dark";
  colors: {
    bodyBackground: string;
    bodyForeground: string;
    controlBackground: string;
    controlForeground: string;
  };
};

/**
 * Reads the current Office theme and returns a host-normalized snapshot.
 *
 * For Outlook, mode is derived from the luminance of `bodyBackgroundColor`.
 * Microsoft documents `isDarkTheme`, `themeId`, and `fluentThemeData` as
 * "not supported in Outlook" — the host bridges them through as sentinel
 * strings (`"#000001"`, `"#NaN"`, etc.) that look usable but aren't part of
 * the contract. See https://learn.microsoft.com/en-us/javascript/api/office/office.officetheme
 *
 * Other hosts (Excel, Word, PowerPoint) read `isDarkTheme` directly.
 *
 * Known Outlook-on-Windows bug: theme changes don't propagate until the user
 * fully restarts Outlook — the values cached here stay stale and
 * `OfficeThemeChanged` either doesn't fire or fires with the previous value.
 * Open issue: https://github.com/OfficeDev/office-js/issues/6348
 *
 * The caller passes `host` — this module deliberately does not read
 * `Office.context.host` itself, so it stays pure and easy to test.
 */
export function detectTheme(host: string | null): OfficeThemeSnapshot | null {
  const officeTheme = getOfficeTheme();
  if (!officeTheme) {
    return null;
  }

  const colors = {
    bodyBackground: officeTheme.bodyBackgroundColor,
    bodyForeground: officeTheme.bodyForegroundColor,
    controlBackground: officeTheme.controlBackgroundColor,
    controlForeground: officeTheme.controlForegroundColor,
  };

  const mode: "light" | "dark" =
    host === "Outlook"
      ? isHexDark(colors.bodyBackground)
        ? "dark"
        : "light"
      : officeTheme.isDarkTheme
        ? "dark"
        : "light";

  return { mode, colors };
}

function getOfficeTheme(): Office.OfficeTheme | undefined {
  if (typeof Office === "undefined") {
    return undefined;
  }
  return Office?.context?.officeTheme;
}
