import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// The card family keeps its corner, its inset and the whole concentric
// derivation in this stylesheet, and jsdom loads no CSS, so the component tests
// can only see that the classes are on the elements. Deleting a rule here would
// leave the suite green while every framed surface in the app went square.
//
// Comments go first so a selector named in prose cannot be read as a rule, and
// whitespace collapses so prettier is free to rewrap any of it.
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

/** Every `.card-skin` rule that qualifies the base one, with its declarations. */
function qualifiedSkinRules(): { selector: string; body: string }[] {
  return Array.from(globalsCss.matchAll(/(\.card-skin[^{}]*)\{([^}]*)\}/g))
    .map((match) => ({
      selector: match[1].replace(/\s/g, ""),
      body: match[2].replace(/\s/g, ""),
    }))
    .filter((rule) => rule.selector !== ".card-skin");
}

describe("card shape channels", () => {
  it("declares every class the primitive puts on an element", () => {
    for (const selector of [
      ".card-geometry",
      ".card-nested",
      ".card-body-geometry",
      ".card-section",
      ".card-skin",
      ".card-inset-none",
      ".card-inset-xs",
      ".card-inset-sm",
      ".card-inset-md",
      ".card-inset-lg",
      ".card-inset-xl",
    ]) {
      expect(ruleBody(selector).length).toBeGreaterThan(0);
    }
  });

  it("puts the geometry inside the components layer and the skin outside it", () => {
    // Which side of the layer a rule sits on is the whole cascade contract:
    // the shape has to lose to a caller's utility and the surface has to beat
    // one. Indentation is what says so in this file, so it is what is pinned.
    expect(rawCss).toMatch(/^\s+\.card-geometry \{/m);
    expect(rawCss).toMatch(/^\s+\.card-body-geometry \{/m);
    expect(rawCss).toMatch(/^\s+\.card-section \{/m);
    expect(rawCss).toMatch(/^\.card-skin \{/m);
  });

  it("derives the corner from the frame's own radius token", () => {
    declares(".card-geometry", "--card-radius", "var(--theme-radius-card)");
    declares(".card-geometry", "border-radius", "var(--card-radius)");
  });

  it("publishes the nested corner and inset from the body, on a floor", () => {
    // Published by the body wrapper and read by the frame below it. A frame
    // that declared what it also reads would be a custom-property cycle, and
    // the whole nest would resolve to nothing at every depth.
    declares(
      ".card-body-geometry",
      "--card-child-radius",
      "max(0px, var(--card-radius) - var(--card-inset))",
    );
    declares(
      ".card-body-geometry",
      "--card-child-inset",
      "max(0px, var(--card-inset) - 0.25rem)",
    );
    declares(".card-body-geometry", "padding", "var(--card-inset)");

    declares(
      ".card-nested",
      "--card-radius",
      "var(--card-child-radius, var(--theme-radius-card))",
    );
  });

  it("spells the empty inset as a length", () => {
    // A bare `0` is not a <length> inside calc() or max(), so the derived
    // corner would fall back to its initial value with no error anywhere.
    declares(".card-inset-none", "--card-inset", "0px");
  });

  it("reads every skin colour through a variable with a token fallback", () => {
    declares(
      ".card-skin",
      "border-color",
      "var(--card-border, var(--theme-border))",
    );
    declares(
      ".card-skin",
      "background-color",
      "var(--card-bg, var(--theme-bg-primary))",
    );
    declares(".card-skin", "box-shadow", "var(--card-shadow, none)");
  });

  it("moves variables only in the tone and state rules", () => {
    const rules = qualifiedSkinRules();

    // Selected, hover and expanded at least; a tone rule for each non-neutral
    // value on top of those.
    expect(rules.length).toBeGreaterThanOrEqual(3);

    for (const { selector, body } of rules) {
      const properties = body
        .split(";")
        .filter(Boolean)
        .map((declaration) => declaration.split(":")[0]);

      // A final value here would be unreachable: these rules sit after the
      // utilities and outrank anything a call site can write, so a theme could
      // only undo them by matching every selector one at a time.
      expect(properties, selector).not.toHaveLength(0);
      for (const property of properties) {
        expect(property, selector).toMatch(/^--card-/);
      }
    }
  });

  it("keeps the hover paint off a chosen or unavailable card", () => {
    const hover = qualifiedSkinRules().filter(({ selector }) =>
      selector.includes(":hover"),
    );

    expect(hover.length).toBeGreaterThan(0);
    for (const { selector } of hover) {
      // Inside :where(), so the exclusions cost no specificity and a theme's
      // own hover rule still meets this one on level ground.
      expect(selector).toContain(
        ":where(:not([data-selected],[data-disabled],:disabled))",
      );
    }
  });
});
