import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { darkTheme, defaultTheme } from "@/config/theme";

// index.html paints the page colour before any code loads, so it cannot
// import the theme; this keeps its copy of the default colours honest.
describe("index.html start colours", () => {
  it("match the default theme's page colour in light and dark", () => {
    const html = readFileSync(join(process.cwd(), "index.html"), "utf8");
    const defaults = /var defaults = \{ light: "([^"]+)", dark: "([^"]+)" \}/.exec(
      html,
    );

    expect(defaults?.slice(1)).toEqual([
      defaultTheme.colors.shell.page,
      darkTheme.colors.shell.page,
    ]);
  });
});
