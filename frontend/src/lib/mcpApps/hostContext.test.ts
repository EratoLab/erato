import { describe, expect, it } from "vitest";

import { darkTheme, defaultTheme } from "@/config/theme";

import {
  MAX_VIEW_HEIGHT,
  viewHostContext,
  viewStyleVariables,
} from "./hostContext";

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

  it("leaves the font out for a theme without typography", () => {
    expect(
      viewStyleVariables({ ...defaultTheme, typography: undefined }),
    ).not.toHaveProperty("--font-sans");
  });
});
