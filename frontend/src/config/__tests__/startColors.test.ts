import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  START_COLORS_STYLE_ID,
  THEME_MODE_LOCAL_STORAGE_KEY,
} from "@/components/providers/ThemeProvider";
import { darkTheme, defaultTheme } from "@/config/theme";

// index.html paints the page colour before any code loads, so it cannot
// import the theme; this keeps its copy of the default colours honest.
const html = readFileSync(join(process.cwd(), "index.html"), "utf8");

describe("index.html start colours", () => {
  it("match the default theme's page colour in light and dark", () => {
    const defaults =
      /var defaults = \{ light: "([^"]+)", dark: "([^"]+)" \}/.exec(html);

    expect(defaults?.slice(1)).toEqual([
      defaultTheme.colors.shell.page,
      darkTheme.colors.shell.page,
    ]);
  });

  it("use the theme mode setting and the style ThemeProvider removes", () => {
    expect(html).toContain(
      `localStorage.getItem("${THEME_MODE_LOCAL_STORAGE_KEY}")`,
    );
    expect(html).toContain(`style.id = "${START_COLORS_STYLE_ID}"`);
  });

  describe("start script", () => {
    const script =
      /<script>\s*(\(function \(\) \{[\s\S]*?\}\)\(\);)\s*<\/script>/.exec(
        html,
      )?.[1];
    const run = (options: {
      mode?: string;
      systemDark?: boolean;
      colors?: unknown;
    }) => {
      document.getElementById(START_COLORS_STYLE_ID)?.remove();
      localStorage.clear();
      if (options.mode) localStorage.setItem("theme-mode", options.mode);
      window.matchMedia = vi.fn().mockReturnValue({
        matches: options.systemDark ?? false,
      });
      vi.stubGlobal("CSS", {
        supports: (_property: string, value: string) =>
          /^#[0-9a-f]+$/i.test(value),
      });
      (window as { THEME_START_COLORS?: unknown }).THEME_START_COLORS =
        options.colors;
      new Function(script ?? "")();
      return {
        theme: document.documentElement.getAttribute("data-theme"),
        css: document.getElementById(START_COLORS_STYLE_ID)?.textContent,
      };
    };

    afterEach(() => {
      document.getElementById(START_COLORS_STYLE_ID)?.remove();
      document.documentElement.removeAttribute("data-theme");
      delete (window as { THEME_START_COLORS?: unknown }).THEME_START_COLORS;
      vi.unstubAllGlobals();
    });

    it("paints the server's colour for the mode the app will use", () => {
      const colors = { light: "#ffffff", dark: "#000000" };
      expect(run({ colors, systemDark: true })).toEqual({
        theme: "dark",
        css: ":root:root{--theme-bg-primary:#000000;--theme-shell-page:#000000}",
      });
      expect(run({ colors, mode: "light", systemDark: true }).theme).toBe(
        "light",
      );
    });

    it("keeps the default colour for a mode the theme leaves alone or a value that is no colour", () => {
      expect(run({ colors: { light: "#ffffff" }, mode: "dark" }).css).toContain(
        darkTheme.colors.shell.page,
      );
      expect(run({ colors: { light: "red}body{display:none" } }).css).toContain(
        defaultTheme.colors.shell.page,
      );
    });
  });
});
