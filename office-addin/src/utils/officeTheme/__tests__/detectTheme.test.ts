import { describe, it, expect, afterEach } from "vitest";

import { detectTheme } from "../detectTheme";

type OfficeThemeLike = {
  bodyBackgroundColor: string;
  bodyForegroundColor: string;
  controlBackgroundColor: string;
  controlForegroundColor: string;
  isDarkTheme: boolean;
  themeId?: unknown;
};

function installOfficeTheme(theme: OfficeThemeLike) {
  (Office.context as unknown as Record<string, unknown>).officeTheme = theme;
}

function uninstallOfficeTheme() {
  delete (Office.context as unknown as Record<string, unknown>).officeTheme;
}

const lightTheme: OfficeThemeLike = {
  bodyBackgroundColor: "#FFFFFF",
  bodyForegroundColor: "#000000",
  controlBackgroundColor: "#F3F3F3",
  controlForegroundColor: "#222222",
  isDarkTheme: false,
};

const darkTheme: OfficeThemeLike = {
  bodyBackgroundColor: "#1F1F1F",
  bodyForegroundColor: "#FFFFFF",
  controlBackgroundColor: "#2B2B2B",
  controlForegroundColor: "#FFFFFF",
  isDarkTheme: true,
};

describe("detectTheme", () => {
  afterEach(() => {
    uninstallOfficeTheme();
  });

  it("returns null when Office.context.officeTheme is unavailable", () => {
    expect(detectTheme("Outlook")).toBeNull();
    expect(detectTheme("Excel")).toBeNull();
    expect(detectTheme(null)).toBeNull();
  });

  it("derives Outlook mode from bodyBackgroundColor luminance (dark bg → dark)", () => {
    installOfficeTheme({
      ...darkTheme,
      isDarkTheme: false, // Outlook does not populate this; must be ignored
    });

    const snapshot = detectTheme("Outlook");

    expect(snapshot).not.toBeNull();
    expect(snapshot?.mode).toBe("dark");
    expect(snapshot?.colors).toEqual({
      bodyBackground: "#1F1F1F",
      bodyForeground: "#FFFFFF",
      controlBackground: "#2B2B2B",
      controlForeground: "#FFFFFF",
    });
  });

  it("derives Outlook mode from bodyBackgroundColor luminance (light bg → light)", () => {
    installOfficeTheme({
      ...lightTheme,
      isDarkTheme: true, // ignored for Outlook
    });

    const snapshot = detectTheme("Outlook");

    expect(snapshot?.mode).toBe("light");
  });

  it("uses isDarkTheme directly for non-Outlook hosts (true → dark)", () => {
    installOfficeTheme(darkTheme);

    expect(detectTheme("Excel")?.mode).toBe("dark");
    expect(detectTheme("Word")?.mode).toBe("dark");
    expect(detectTheme("PowerPoint")?.mode).toBe("dark");
  });

  it("uses isDarkTheme directly for non-Outlook hosts (false → light)", () => {
    installOfficeTheme({ ...darkTheme, isDarkTheme: false });

    expect(detectTheme("Excel")?.mode).toBe("light");
  });

  it("uses isDarkTheme for an unknown or null host (non-Outlook branch)", () => {
    installOfficeTheme(darkTheme);

    expect(detectTheme(null)?.mode).toBe("dark");
    expect(detectTheme("Unknown")?.mode).toBe("dark");
  });
});
