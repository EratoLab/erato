import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/styles/globals.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/\s+/g, " ");

describe(".focus-ring", () => {
  it("offsets the ring in the theme's own colour, never the default white", () => {
    const rule = /\.focus-ring \{([^}]*)\}/.exec(css)?.[1] ?? "";

    expect(rule).toContain("focus-visible:ring-offset-2");
    expect(rule).toContain("focus-visible:ring-offset-theme-bg-primary");
  });
});
