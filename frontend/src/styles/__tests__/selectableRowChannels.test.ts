import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// SelectableRow and ProgressBar keep their state colours, focus ring and
// forced-colors edges in this stylesheet, and jsdom loads no CSS, so the
// component tests only see the data attributes. Reordering or dropping a rule
// here would leave them green while a flagged, selected row lost its warning
// fill or hovered meta text fell below contrast.
//
// Comments go first so a selector named in prose cannot be read as a rule, and
// whitespace collapses so prettier is free to rewrap any of it.
const globalsCss = readFileSync(
  join(process.cwd(), "src/styles/globals.css"),
  "utf8",
)
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/\s+/g, " ");

function ruleIndex(selector: string, from = 0): number {
  const index = globalsCss.indexOf(`${selector} {`, from);
  expect(index, `no rule for ${selector}`).toBeGreaterThanOrEqual(0);
  return index;
}

function ruleBody(selector: string, from = 0): string {
  const start = ruleIndex(selector, from) + selector.length + 2;
  return globalsCss
    .slice(start, globalsCss.indexOf("}", start))
    .replace(/\s/g, "");
}

function declares(selector: string, property: string, value: string): void {
  expect(ruleBody(selector)).toContain(
    `${property}:${value.replace(/\s/g, "")};`,
  );
}

const HOVER =
  '.selectable-row-skin:hover:where( :not([data-tone="warning"], [data-tone="error"], [data-disabled]) )';

describe("selectable row channels", () => {
  it("paints from variables and defaults the divider to the subtle border", () => {
    declares(
      ".selectable-row-skin",
      "background-color",
      "var(--selectable-row-bg, transparent)",
    );
    declares(
      ".selectable-row-skin",
      "border-block-start-color",
      "var(--selectable-row-divider, var(--theme-border-subtle))",
    );
  });

  it("steps meta up to fg-secondary on the hover and selected fills", () => {
    declares(HOVER, "--selectable-row-bg", "var(--theme-bg-hover)");
    declares(HOVER, "--selectable-row-meta", "var(--theme-fg-secondary)");
    declares(
      ".selectable-row-skin[data-selected]",
      "--selectable-row-meta",
      "var(--theme-fg-secondary)",
    );
  });

  it("orders tone after selection, and disabled last", () => {
    // Equal specificity: only source order keeps a selected, flagged row on
    // its warning fill.
    const selected = ruleIndex(".selectable-row-skin[data-selected]");
    const warning = ruleIndex('.selectable-row-skin[data-tone="warning"]');
    const error = ruleIndex('.selectable-row-skin[data-tone="error"]');
    const disabled = ruleIndex(".selectable-row-skin[data-disabled]");

    expect(ruleIndex(HOVER)).toBeLessThan(selected);
    expect(warning).toBeGreaterThan(selected);
    expect(error).toBeGreaterThan(warning);
    expect(disabled).toBeGreaterThan(error);
    declares(
      '.selectable-row-skin[data-tone="warning"]',
      "--selectable-row-meta",
      "var(--theme-warning-fg)",
    );
  });

  it("rings the row for a focused checkbox and drops the checkbox's own ring", () => {
    const supports = globalsCss.indexOf("@supports selector(:has(*)) {");
    expect(supports).toBeGreaterThanOrEqual(0);

    const ring = ruleBody(
      '.selectable-row-skin:has( > [data-ui="selectable-row-check"] input:focus-visible )',
      supports,
    );
    expect(ring).toContain("outline:2pxsolidvar(--theme-focus-ring);");
    expect(
      ruleBody(
        '.selectable-row-skin > [data-ui="selectable-row-check"] input:focus-visible',
        supports,
      ),
    ).toContain("outline:none;");
  });

  it("keeps an edge on toned and current rows under forced colors", () => {
    const forced = globalsCss.indexOf(
      "@media (forced-colors: active) { .selectable-row-skin",
    );
    expect(forced).toBeGreaterThanOrEqual(0);
    const block = globalsCss.slice(forced, globalsCss.indexOf("} }", forced));

    for (const selector of [
      '.selectable-row-skin[data-tone="warning"]',
      '.selectable-row-skin[data-tone="error"]',
      ".selectable-row-skin[data-current]",
    ]) {
      expect(block).toContain(selector);
    }
    expect(block).toContain("outline: 1px solid CanvasText;");
  });

  it("sizes the end column for the widest shipped date and declares the tokens", () => {
    declares(
      ".selectable-row-geometry",
      "grid-template-columns",
      "1.5rem 1rem minmax(0, 1fr) var(--selectable-row-meta-width, 9.5rem) var(--selectable-row-end-width, 9.25rem) 1.375rem",
    );

    // The light-theme defaults, beside the other component tokens.
    const root = ruleBody(
      ":root",
      globalsCss.lastIndexOf(
        ":root {",
        globalsCss.indexOf("--theme-starter-prompt-bg:"),
      ),
    );
    for (const token of [
      "--theme-radius-selectable-row:0;",
      "--theme-spacing-selectable-row-height:2.25rem;",
      "--theme-spacing-selectable-row-padding-y:0.4375rem;",
      "--theme-spacing-selectable-row-padding-x:var(--theme-spacing-window-gutter);",
      "--theme-selectable-row-selected-bg:var(--theme-bg-secondary);",
    ]) {
      expect(root).toContain(token);
    }
  });
});

describe("progress channels", () => {
  it("paints track and fill from variables with a warning tone", () => {
    declares(
      ".progress-skin",
      "background-color",
      "var(--progress-track, var(--theme-bg-accent))",
    );
    declares(
      '.progress-skin[data-tone="warning"]',
      "--progress-fill",
      "var(--theme-warning-fg)",
    );
    declares(
      ".progress-fill-skin",
      "background-color",
      "var(--progress-fill, var(--theme-fg-accent))",
    );
  });

  it("drops the fill transition under reduced motion", () => {
    const reduced = globalsCss.indexOf(
      "@media (prefers-reduced-motion: reduce) { .progress-fill-skin {",
    );
    expect(reduced).toBeGreaterThanOrEqual(0);
    expect(ruleBody(".progress-fill-skin", reduced)).toContain(
      "transition:none;",
    );
  });

  it("outlines the track and fills with Highlight under forced colors", () => {
    const forced = globalsCss.indexOf(
      "@media (forced-colors: active) { .progress-skin {",
    );
    expect(forced).toBeGreaterThanOrEqual(0);
    expect(ruleBody(".progress-skin", forced)).toContain(
      "outline:1pxsolidCanvasText;",
    );
    expect(ruleBody(".progress-fill-skin", forced)).toContain(
      "background-color:Highlight;",
    );
  });
});
