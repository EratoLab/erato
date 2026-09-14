import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// jsdom loads no CSS, so the component tests only see that the classes are
// present. Source order decides one of the rules below, which nothing else can
// observe. Comments are stripped first so a selector named in prose cannot be
// read as a rule, and whitespace collapses so prettier may rewrap freely.
const rawCss = readFileSync(
  join(process.cwd(), "src/styles/globals.css"),
  "utf8",
);

const globalsCss = rawCss
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/\s+/g, " ");

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[[\]"$^*+?.()|{}\\]/g, "\\$&");
  const match = new RegExp(`${escaped} \\{([^}]*)\\}`).exec(globalsCss);

  expect(match, `no rule for ${selector}`).not.toBeNull();

  return match![1].replace(/\s/g, "");
}

function declares(selector: string, property: string, value: string): void {
  expect(ruleBody(selector)).toContain(
    `${property}:${value.replace(/\s/g, "")};`,
  );
}

describe("sidebar chrome shape channels", () => {
  it("zeroes the flush band's padding after the skin declares it", () => {
    // Both are specificity 0,1,0 and both set padding, so only order separates
    // them. The add-in carried `!p-0` for as long as its rule came first.
    const skin = globalsCss.indexOf(".sidebar-section-skin {");
    const flush = globalsCss.indexOf(".sidebar-band-flush {");

    expect(skin).toBeGreaterThanOrEqual(0);
    expect(flush).toBeGreaterThan(skin);
    declares(".sidebar-band-flush", "padding", "0");
  });

  it("gives the floating skin an opaque base under the sidebar tone", () => {
    // Dropping the gradient for a plain background-color would bring back the
    // see-through control on a glass theme.
    declares(
      ".floating-control-skin",
      "background-color",
      "var(--theme-shell-app, var(--theme-bg-primary))",
    );
    declares(
      ".floating-control-skin",
      "background-image",
      "linear-gradient( var(--theme-shell-sidebar), var(--theme-shell-sidebar) )",
    );
    declares(
      ".floating-control-skin",
      "border-color",
      "var(--theme-border-divider)",
    );
    declares(
      ".floating-control-skin",
      "border-radius",
      "var(--theme-radius-shell)",
    );
    declares(
      ".floating-control-skin",
      "box-shadow",
      "var(--theme-elevation-shell)",
    );
  });

  it("reads its corner from a token, so a theme can retune it", () => {
    // The four inline borderRadius objects this replaced were unreachable at
    // any specificity.
    expect(ruleBody(".floating-control-skin")).not.toMatch(
      /border-radius:\s*\d/,
    );
  });
});
