import { describe, expect, it } from "vitest";

import { darkTheme, defaultTheme } from "@/config/theme";

import {
  MAX_VIEW_HEIGHT,
  viewBackgroundColor,
  viewHostContext,
  viewStyleVariables,
} from "./hostContext";

import type { Theme, ThemeColors } from "@/config/theme";

/** The theme with some of its message and surface colours replaced. */
const withSurfaces = (
  theme: Theme,
  colors: {
    message?: Partial<ThemeColors["message"]>;
    shell?: Partial<ThemeColors["shell"]>;
    background?: Partial<ThemeColors["background"]>;
  },
): Theme => ({
  ...theme,
  colors: {
    ...theme.colors,
    message: { ...theme.colors.message, ...colors.message },
    shell: { ...theme.colors.shell, ...colors.shell },
    background: { ...theme.colors.background, ...colors.background },
  },
});

describe("viewHostContext", () => {
  it("gives the view the message column's width under the height cap, with the theme, language and time zone", () => {
    expect(
      viewHostContext({
        theme: "dark",
        width: 640,
        locale: "de",
        timeZone: "Europe/Berlin",
      }),
    ).toEqual({
      theme: "dark",
      platform: "web",
      displayMode: "inline",
      availableDisplayModes: ["inline"],
      containerDimensions: { width: 640, maxHeight: MAX_VIEW_HEIGHT },
      locale: "de",
      timeZone: "Europe/Berlin",
    });
  });

  it("leaves out the width until it is measured, and a language or time zone it does not know", () => {
    const context = viewHostContext({ theme: "light" });

    expect(context.containerDimensions).toEqual({
      maxHeight: MAX_VIEW_HEIGHT,
    });
    expect(context).not.toHaveProperty("locale");
    expect(context).not.toHaveProperty("timeZone");
    expect(context).not.toHaveProperty("styles");
  });

  it("gives the app's theme as the standard style variables", () => {
    expect(
      viewHostContext({ theme: "light", appTheme: defaultTheme }).styles,
    ).toEqual({ variables: viewStyleVariables(defaultTheme) });
  });
});

describe("viewStyleVariables", () => {
  it("maps the message background, the text colours, the border and the body font onto the standard names", () => {
    expect(viewStyleVariables(defaultTheme)).toEqual({
      "--color-background-primary": defaultTheme.colors.message.assistant,
      "--color-text-primary": defaultTheme.colors.foreground.primary,
      "--color-text-secondary": defaultTheme.colors.foreground.secondary,
      "--color-text-tertiary": defaultTheme.colors.foreground.muted,
      "--color-border-primary": defaultTheme.colors.border.default,
      "--font-sans": "Geist Variable, ui-sans-serif, system-ui, sans-serif",
    });
  });

  it("follows the dark theme", () => {
    const variables = viewStyleVariables(darkTheme);

    expect(variables["--color-background-primary"]).toBe(
      darkTheme.colors.message.assistant,
    );
    expect(variables["--color-text-primary"]).toBe(
      darkTheme.colors.foreground.primary,
    );
    expect(variables["--color-background-primary"]).not.toBe(
      viewStyleVariables(defaultTheme)["--color-background-primary"],
    );
  });

  it("gives the chat body's colour as the background when the message is transparent, in either theme", () => {
    for (const theme of [defaultTheme, darkTheme]) {
      const variables = viewStyleVariables(
        withSurfaces(theme, { message: { assistant: "transparent" } }),
      );

      expect(variables["--color-background-primary"]).toBe(
        theme.colors.shell.chatBody,
      );
    }
  });

  it("passes over a translucent or unresolved surface to the first opaque one beneath it", () => {
    const theme = withSurfaces(defaultTheme, {
      message: { assistant: "rgba(15, 23, 42, 0.03)" },
      shell: {
        chatBody: "var(--theme-bg-secondary)",
        page: "#f8fafc80",
        app: "#fcfcfb",
      },
    });

    expect(viewBackgroundColor(theme)).toBe("#fcfcfb");
  });

  it("takes an opaque message colour in any notation", () => {
    for (const assistant of [
      "#fff",
      "#f8fafcff",
      "rgb(248, 250, 252)",
      "rgba(248, 250, 252, 1)",
      "hsl(210 40% 98% / 100%)",
      "white",
    ]) {
      expect(
        viewBackgroundColor(
          withSurfaces(defaultTheme, { message: { assistant } }),
        ),
      ).toBe(assistant);
    }
  });

  it("leaves the background out when no surface has an opaque colour", () => {
    const theme = withSurfaces(defaultTheme, {
      message: { assistant: "transparent" },
      shell: {
        chatBody: "transparent",
        page: "transparent",
        app: "transparent",
      },
      background: { primary: "rgba(0, 0, 0, 0)" },
    });

    expect(viewStyleVariables(theme)).not.toHaveProperty(
      "--color-background-primary",
    );
  });

  it("leaves the font out for a theme without typography", () => {
    expect(
      viewStyleVariables({ ...defaultTheme, typography: undefined }),
    ).not.toHaveProperty("--font-sans");
  });
});
