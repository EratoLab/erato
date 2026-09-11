import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// jsdom loads no CSS, so the derivation is only assertable as rule text.
// Comments are stripped first so a selector named in prose is not read as a rule.
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

describe("list row shape channels", () => {
  it("reads the corner the card well publishes, with the token behind it", () => {
    // The fallback is what a menu row's read deliberately does without: a list
    // row is not guaranteed a well above it, so it has to stay round on its own.
    expect(ruleBody(".list-row-geometry")).toContain(
      "border-radius:var(--card-child-radius,var(--theme-radius-control));",
    );
  });

  it("keeps the rule outside the components layer", () => {
    // Unlayered is what puts the corner out of reach of a call site's own
    // rounded-* utility while a customer theme.css still outranks it.
    expect(rawCss).toMatch(/^\.list-row-geometry \{/m);
  });
});
