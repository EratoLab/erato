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
    expect(mergedTheme.colors.border.field).toBe("#ea580c");
    expect(mergedTheme.colors.border.chatInput).toBe("#ea580c");
    // These two alias divider/primary, which follow border.default, so they
    // land on the override like every other border. They previously read the
    // pre-merge theme and kept the built-in grey.
    expect(mergedTheme.colors.border.dropdown).toBe("#ea580c");
    expect(mergedTheme.colors.border.media).toBe("#ea580c");
    expect(mergedTheme.colors.border.attachment).toBe("#ea580c");
  });

  it("still lets an explicit dropdown or media border win over the alias", () => {
    const mergedTheme = mergeThemeWithOverrides(defaultTheme, {
      colors: {
        border: {
          default: "#ea580c",
          dropdown: "#123456",
          media: "#654321",
        },
      },
    });

    expect(mergedTheme.colors.border.dropdown).toBe("#123456");
    expect(mergedTheme.colors.border.media).toBe("#654321");
    expect(mergedTheme.colors.border.divider).toBe("#ea580c");
  });

  it("resolves dropdown and media through an explicitly overridden alias source", () => {
    const mergedTheme = mergeThemeWithOverrides(defaultTheme, {
      colors: {
        border: {
          default: "#ea580c",
          divider: "#00ff00",
          primary: "#0000ff",
        },
      },
    });

    // dropdown aliases divider and media aliases primary, so an explicit value
    // for those sources has to carry through rather than being bypassed.
    expect(mergedTheme.colors.border.dropdown).toBe("#00ff00");
    expect(mergedTheme.colors.border.media).toBe("#0000ff");
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

  it("derives legacy border focus and surface borders into the expanded border token set", () => {
    const mergedTheme = mergeThemeWithOverrides(defaultTheme, {
      colors: {
        border: {
          default: "#94a3b8",
          focus: "#64748b",
        },
      },
    });

    expect(mergedTheme.colors.border.field).toBe("#94a3b8");
    expect(mergedTheme.colors.border.chatInput).toBe("#94a3b8");
    expect(mergedTheme.colors.border.dropdown).toBe("#94a3b8");
    expect(mergedTheme.colors.border.media).toBe("#94a3b8");
    expect(mergedTheme.colors.border.attachment).toBe("#94a3b8");
    expect(mergedTheme.colors.border.fieldFocus).toBe("#64748b");
    expect(mergedTheme.colors.border.chatInputFocus).toBe("#64748b");
  });

  it("merges code highlight preset and block style overrides", () => {
    const mergedTheme = mergeThemeWithOverrides(defaultTheme, {
      codeHighlight: {
        preset: "night-owl",
        blockStyle: {
          borderRadius: "0.75rem",
          fontFamily: '"IBM Plex Mono", monospace',
        },
      },
    });

    expect(mergedTheme.codeHighlight.preset).toBe("night-owl");
    expect(mergedTheme.codeHighlight.blockStyle).toMatchObject({
      borderRadius: "0.75rem",
      fontFamily: '"IBM Plex Mono", monospace',
    });
  });

  // globals.css declares --theme-font-heading/--theme-font-semibold as aliases of
  // --theme-font-body, and --theme-font-heading-bold as an alias of
  // --theme-font-heading. ThemeProvider emits all of them explicitly, so the merge
  // has to reproduce that alias chain or a brand font only half-applies.
  it("back-fills heading, semibold and headingBold from a body-only font override", () => {
    const mergedTheme = mergeThemeWithOverrides(defaultTheme, {
      typography: { fontFamily: { body: "Brand Sans" } },
    });

    expect(mergedTheme.typography?.fontFamily).toMatchObject({
      body: "Brand Sans",
      heading: "Brand Sans",
      semibold: "Brand Sans",
      headingBold: "Brand Sans",
      // mono has no alias in globals.css, so it must keep the default
      mono: defaultTheme.typography?.fontFamily.mono,
    });
  });

  it("resolves headingBold from an explicit heading rather than from body", () => {
    const mergedTheme = mergeThemeWithOverrides(defaultTheme, {
      typography: {
        fontFamily: { body: "Brand Sans", heading: "Brand Display" },
      },
    });

    expect(mergedTheme.typography?.fontFamily).toMatchObject({
      body: "Brand Sans",
      heading: "Brand Display",
      semibold: "Brand Sans",
      headingBold: "Brand Display",
    });
  });

  it("back-fills headingBold from heading even when body is not overridden", () => {
    const mergedTheme = mergeThemeWithOverrides(defaultTheme, {
      typography: { fontFamily: { heading: "Brand Display" } },
    });

    expect(mergedTheme.typography?.fontFamily).toMatchObject({
      body: defaultTheme.typography?.fontFamily.body,
      heading: "Brand Display",
      semibold: defaultTheme.typography?.fontFamily.semibold,
      headingBold: "Brand Display",
    });
  });

  it("preserves explicitly overridden font families over the back-filled ones", () => {
    const mergedTheme = mergeThemeWithOverrides(defaultTheme, {
      typography: {
        fontFamily: {
          body: "Brand Sans",
          semibold: "Brand Sans Semibold",
          headingBold: "Brand Display Bold",
        },
      },
    });

    expect(mergedTheme.typography?.fontFamily).toMatchObject({
      body: "Brand Sans",
      heading: "Brand Sans",
      semibold: "Brand Sans Semibold",
      headingBold: "Brand Display Bold",
    });
  });

  it("leaves font families untouched when the override sets no font family", () => {
    const mergedTheme = mergeThemeWithOverrides(defaultTheme, {
      typography: { fontSize: { base: "1.125rem" } },
    });

    expect(mergedTheme.typography?.fontSize.base).toBe("1.125rem");
    expect(mergedTheme.typography?.fontFamily).toEqual(
      defaultTheme.typography?.fontFamily,
    );
  });
});
