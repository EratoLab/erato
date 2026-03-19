import { describe, expect, it } from "vitest";

import { defaultTheme } from "@/config/theme";

import { mergeThemeWithOverrides } from "./themeUtils";

describe("mergeThemeWithOverrides", () => {
  it("maps legacy borderRadius overrides onto the new radius tokens", () => {
    const mergedTheme = mergeThemeWithOverrides(defaultTheme, {
      borderRadius: "1.25rem",
    });

    expect(mergedTheme.borderRadius).toBe("1.25rem");
    expect(mergedTheme.radius).toEqual({
      base: "1.25rem",
      shell: "1.25rem",
      input: "1.25rem",
      control: "1.25rem",
      message: "1.25rem",
      modal: "1.25rem",
      pill: "1.25rem",
    });
  });

  it("derives shell and message surfaces from legacy background and message hover values", () => {
    const mergedTheme = mergeThemeWithOverrides(defaultTheme, {
      colors: {
        background: {
          primary: "#fff7ed",
          secondary: "#ffedd5",
          tertiary: "#ffffff",
          sidebar: "#fed7aa",
          hover: "#fdba74",
          selected: "#fb923c",
        },
        border: {
          default: "#ea580c",
        },
        messageItem: {
          hover: "#f97316",
        },
      },
    });

    expect(mergedTheme.colors.shell).toMatchObject({
      app: "#fff7ed",
      page: "#ffedd5",
      sidebar: "#fed7aa",
      sidebarHover: "#fdba74",
      sidebarSelected: "#fb923c",
      chatHeader: "#ffedd5",
      chatBody: "#ffedd5",
      chatInput: "#ffffff",
      modal: "#fff7ed",
      dropdown: "#fff7ed",
    });
    expect(mergedTheme.colors.message).toMatchObject({
      user: "#fff7ed",
      assistant: "#ffedd5",
      hover: "#f97316",
      controls: "#ffedd5",
    });
    expect(mergedTheme.colors.border.primary).toBe("#ea580c");
    expect(mergedTheme.colors.border.subtle).toBe("#ea580c");
    expect(mergedTheme.colors.border.divider).toBe("#ea580c");
  });

  it("preserves explicit new token overrides over legacy-derived values", () => {
    const mergedTheme = mergeThemeWithOverrides(defaultTheme, {
      borderRadius: "1.25rem",
      radius: {
        modal: "2rem",
      },
      colors: {
        background: {
          primary: "#0f172a",
          hover: "#1e293b",
        },
        shell: {
          modal: "#111827",
        },
        message: {
          hover: "#334155",
        },
      },
    });

    expect(mergedTheme.radius.modal).toBe("2rem");
    expect(mergedTheme.radius.shell).toBe("1.25rem");
    expect(mergedTheme.colors.shell.modal).toBe("#111827");
    expect(mergedTheme.colors.message.hover).toBe("#334155");
  });

  it("merges code highlight preset and block style overrides", () => {
    const mergedTheme = mergeThemeWithOverrides(defaultTheme, {
      codeHighlight: {
        preset: "night-owl",
        blockStyle: {
          borderRadius: "0.75rem",
          fontFamily: "\"IBM Plex Mono\", monospace",
        },
      },
    });

    expect(mergedTheme.codeHighlight.preset).toBe("night-owl");
    expect(mergedTheme.codeHighlight.blockStyle).toMatchObject({
      borderRadius: "0.75rem",
      fontFamily: "\"IBM Plex Mono\", monospace",
    });
  });
});
