import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// The tab rail family keeps its gap, its track inset and the whole concentric
// corner derivation in this stylesheet, and jsdom loads no CSS, so the
// component tests can only see that the classes are on the elements. Deleting
// a rule here would leave the suite green while every tab in the app went
// square, or every segmented track lost its frame.
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

/**
 * The text of the `@layer components` block, brace-matched, because the layer
 * nests media queries and keyframes and a flat regex would stop at the first
 * closing brace.
 */
function componentsLayer(): string {
  const open = globalsCss.indexOf("@layer components {");
  expect(open, "no @layer components block").toBeGreaterThanOrEqual(0);

  let depth = 0;
  for (let i = open; i < globalsCss.length; i++) {
    if (globalsCss[i] === "{") {
      depth += 1;
    } else if (globalsCss[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        return globalsCss.slice(open, i + 1);
      }
    }
  }

  throw new Error("unbalanced @layer components block");
}

describe("tab rail shape channels", () => {
  it("declares every class the primitive puts on an element, inside the components layer", () => {
    // Inside the layer so a caller's utility still wins: the segmented
    // wrapper's literal size padding has to beat the item geometry's token
    // padding, or every segmented control changes size.
    const layer = componentsLayer();

    for (const selector of [
      ".tab-rail-geometry",
      ".tab-rail-track-geometry",
      ".tab-item-geometry",
    ]) {
      expect(ruleBody(selector).length).toBeGreaterThan(0);
      expect(layer).toContain(`${selector} {`);
    }
  });

  it("paints the track after the bare rail, so order decides between equals", () => {
    // Same specificity: the track re-declares the gap and the inset the bare
    // rail zeroes, and only source order lets it.
    const rail = globalsCss.indexOf(".tab-rail-geometry {");
    const track = globalsCss.indexOf(".tab-rail-track-geometry {");

    expect(rail).toBeGreaterThanOrEqual(0);
    expect(track).toBeGreaterThan(rail);
  });

  it("spells every zero as a length", () => {
    // A bare `0` is not a <length> inside max(), so the derived corner would
    // fall back to its initial value with no error anywhere — every tab
    // squares silently.
    declares(".tab-rail-geometry", "--tab-rail-track-padding", "0px");
    declares(".tab-rail-geometry", "--tab-rail-track-border-width", "0px");
    declares(".tab-rail-track-geometry", "--tab-rail-gap", "0px");

    for (const selector of [".tab-rail-geometry", ".tab-rail-track-geometry"]) {
      expect(ruleBody(selector)).not.toMatch(/--tab-rail-[a-z-]+:0;/);
    }
  });

  it("declares the track anatomy per variant on the rail", () => {
    declares(".tab-rail-geometry", "--tab-rail-gap", "0.25rem");
    declares(".tab-rail-geometry", "gap", "var(--tab-rail-gap)");

    declares(
      ".tab-rail-track-geometry",
      "--tab-rail-track-padding",
      "0.125rem",
    );
    declares(
      ".tab-rail-track-geometry",
      "--tab-rail-track-border-width",
      "1px",
    );
    declares(
      ".tab-rail-track-geometry",
      "padding",
      "var(--tab-rail-track-padding)",
    );
    declares(
      ".tab-rail-track-geometry",
      "border-width",
      "var(--tab-rail-track-border-width)",
    );
    declares(
      ".tab-rail-track-geometry",
      "border-radius",
      "var(--tab-rail-radius, var(--theme-radius-control))",
    );
  });

  it("derives the tab corner from the rail radius minus the track inset, on a floor", () => {
    declares(
      ".tab-item-geometry",
      "border-radius",
      "max(0px, var(--tab-rail-radius, var(--theme-radius-control)) - var(--tab-rail-track-padding))",
    );
  });

  it("pads every tab from the control tokens", () => {
    declares(
      ".tab-item-geometry",
      "padding-inline",
      "var(--theme-spacing-control-padding-x)",
    );
    declares(
      ".tab-item-geometry",
      "padding-block",
      "var(--theme-spacing-control-padding-y)",
    );
  });

  it("reads the rail radius and never declares it", () => {
    // A declaration on the hook element would shadow a theme's value set on
    // any ancestor, and the shipped retune re-declares the control token on
    // the hook itself, which only reaches the tabs through the fallback.
    for (const selector of [
      ".tab-rail-geometry",
      ".tab-rail-track-geometry",
      ".tab-item-geometry",
    ]) {
      expect(ruleBody(selector)).not.toContain("--tab-rail-radius:");
    }
  });
});
