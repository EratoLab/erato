import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// The popover panels carry their width, their min-width floor and their
// positioning mode as data attributes now, so every one of those values lives
// only in this stylesheet. jsdom loads no CSS, so the component tests can only
// see that the attributes are emitted — deleting a rule here would leave the
// whole suite green while every menu in the app lost its shape.
//
// Comments go first so a selector named in prose cannot be read as a rule, and
// whitespace collapses so prettier is free to rewrap any of it.
const globalsCss = readFileSync(
  join(process.cwd(), "src/styles/globals.css"),
  "utf8",
)
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

describe("popover shape channels", () => {
  it("resolves each width dialect from its token", () => {
    declares(
      '[data-popover-width="min"]',
      "width",
      "var(--theme-layout-dropdown-min-width)",
    );
    declares(
      '[data-popover-width="wide"]',
      "width",
      "var(--theme-layout-dropdown-wide-width)",
    );
    declares('[data-popover-width="content"]', "width", "max-content");
  });

  it("keeps the min-width floor on the fixed panels alone", () => {
    declares('[data-popover-position="fixed"]', "position", "fixed");
    // The floor replaced an inline min-width on all four portalled panels.
    declares(
      '[data-popover-position="fixed"]',
      "min-width",
      "var(--theme-layout-dropdown-min-width)",
    );

    declares('[data-popover-position="absolute"]', "position", "absolute");
    // The flyout sizes to its content; a floor here would widen it.
    expect(ruleBody('[data-popover-position="absolute"]')).not.toContain(
      "min-width",
    );
  });

  it("declares the derived row radius on the skin and reads it on the rows", () => {
    expect(ruleBody(".anchored-popover-skin")).toContain(
      "--dropdown-item-radius:max(",
    );
    declares(
      ".dropdown-item-geometry",
      "border-radius",
      "var(--dropdown-item-radius)",
    );
    // The read is deliberately bare. Every element carrying this class is a
    // menu Row inside a popover panel, so the skin always declares the
    // variable above it; repeating the derivation as a fallback here would
    // hide a row that escaped the panel instead of squaring its corner.
    expect(ruleBody(".dropdown-item-geometry")).not.toContain("max(");
  });

  it("gives every popover layout token a built-in fallback", () => {
    // A theme.json that sets none of them still has to resolve; a bare read
    // with nothing declaring it collapses the panel to auto width.
    for (const token of [
      "--theme-layout-dropdown-min-width",
      "--theme-layout-dropdown-wide-width",
      "--theme-layout-dropdown-viewport-margin",
    ]) {
      expect(globalsCss).toMatch(new RegExp(`${token}: [^;]+;`));
    }
  });
});
