import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// jsdom loads no CSS, so the lane's component tests only see class names and
// data attributes; this pins what those names do.
const rawCss = readFileSync(
  join(process.cwd(), "src/styles/globals.css"),
  "utf8",
);

const globalsCss = rawCss
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/\s+/g, " ");

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[[\]"$^*+?.()|{}\\]/g, "\\$&");
  const match = new RegExp(`(?:^| )${escaped} \\{([^}]*)\\}`).exec(globalsCss);

  expect(match, `no rule for ${selector}`).not.toBeNull();

  return match![1].replace(/\s/g, "");
}

function declares(selector: string, property: string, value: string): void {
  expect(ruleBody(selector)).toContain(
    `${property}:${value.replace(/\s/g, "")};`,
  );
}

function componentsLayer(): string {
  const start = globalsCss.indexOf("@layer components {");
  let depth = 0;
  for (let index = start; index < globalsCss.length; index++) {
    if (globalsCss[index] === "{") depth++;
    if (globalsCss[index] === "}" && --depth === 0) {
      return globalsCss.slice(start, index);
    }
  }
  throw new Error("unterminated @layer components");
}

describe("composer context chip channels", () => {
  it("holds geometry in the components layer and the skin outside it", () => {
    const layer = componentsLayer();
    expect(layer).toContain(".composer-context-chip-geometry {");
    expect(layer).toContain(".composer-context-control-geometry {");
    expect(layer).toContain(".composer-context-more-geometry {");
    expect(layer).not.toContain(".composer-context-chip-skin");
    expect(rawCss).toMatch(/^\.composer-context-chip-skin \{/m);
  });

  it("sizes the chip from its token and takes the tile corner", () => {
    declares(
      ".composer-context-chip-geometry",
      "height",
      "var(--theme-layout-composer-context-chip-height)",
    );
    declares(
      ".composer-context-chip-geometry",
      "border-radius",
      "var(--attachment-tile-radius, var(--theme-radius-base))",
    );
    declares(".composer-context-more-geometry", "height", "2rem");
    declares(
      ".composer-context-more-geometry",
      "border-radius",
      "var(--attachment-tile-radius, var(--theme-radius-base))",
    );
    declares(".composer-context-control-geometry", "width", "1.5rem");
    declares(".composer-context-control-geometry", "height", "1.5rem");
  });

  it("tints the glyph's plate with the glyph's own colour", () => {
    declares(
      ".composer-context-chip-skin",
      "--attachment-tile-icon-tint",
      "var(--composer-context-chip-icon, var(--theme-fg-secondary))",
    );
  });

  it("frames an included chip with the attachment tokens", () => {
    declares(
      ".composer-context-chip-skin",
      "border-color",
      "var(--composer-context-chip-border, var(--theme-border-attachment))",
    );
    declares(
      ".composer-context-chip-skin",
      "background-color",
      "var(--composer-context-chip-bg, var(--theme-bg-secondary))",
    );
  });

  it("dashes a suggested chip on the strong border with no fill", () => {
    const suggested = '.composer-context-chip-skin[data-state="suggested"]';
    declares(suggested, "--composer-context-chip-border-style", "dashed");
    declares(
      suggested,
      "--composer-context-chip-border",
      "var(--theme-border-strong)",
    );
    declares(suggested, "--composer-context-chip-bg", "transparent");
    declares(
      '.composer-context-chip-skin[data-state="suggested"][data-tone]',
      "--composer-context-chip-bg",
      "transparent",
    );
  });

  it("mutes a superseded chip without dropping text contrast", () => {
    const superseded = '.composer-context-chip-skin[data-state="superseded"]';
    declares(superseded, "--composer-context-chip-bg", "transparent");
    declares(superseded, "--composer-context-chip-meta-style", "italic");
    declares(
      superseded,
      "--composer-context-chip-label",
      "var(--theme-fg-secondary)",
    );
    // Muted text tokens measure under 4.5:1 on these fills; only the glyph
    // may use one.
    expect(ruleBody(superseded)).not.toMatch(
      /--composer-context-chip-(label|meta):var\(--theme-fg-muted\)/,
    );
    declares(
      '.composer-context-chip-skin [data-ui="composer-context-chip-meta"]',
      "color",
      "var(--composer-context-chip-meta, var(--theme-fg-secondary))",
    );
  });

  it("tones warning and error chips from their tokens", () => {
    for (const tone of ["warning", "error"]) {
      const selector = `.composer-context-chip-skin[data-tone="${tone}"]`;
      declares(
        selector,
        "--composer-context-chip-border",
        `var(--theme-${tone}-border)`,
      );
      declares(
        selector,
        "--composer-context-chip-bg",
        `var(--theme-${tone}-bg)`,
      );
      declares(
        selector,
        "--composer-context-chip-meta",
        `var(--theme-${tone}-fg)`,
      );
    }
  });

  it("rings a focused chip with or without :has()", () => {
    const open =
      '.composer-context-chip-skin > [data-ui="composer-context-chip-open"]:focus-visible';
    declares(open, "outline", "2px solid var(--theme-focus-ring)");
    const supports = globalsCss.slice(
      globalsCss.indexOf("@supports selector(:has(*)) {"),
    );
    expect(supports).toMatch(
      /^@supports selector\(:has\(\*\)\) \{ \.composer-context-chip-skin > \[data-ui="composer-context-chip-open"\]:focus-visible \{ outline: none; \}/,
    );
    expect(supports).toContain(
      '.composer-context-chip-skin:has( > [data-ui="composer-context-chip-open"]:focus-visible ) {',
    );
  });

  it("steps a superseded chip's frame and glyph back in dark", () => {
    for (const selector of [
      ':root[data-theme="dark"] .composer-context-chip-skin[data-state="superseded"]',
      ':root:not([data-theme="light"]) .composer-context-chip-skin[data-state="superseded"]',
    ]) {
      declares(selector, "--composer-context-chip-icon-opacity", "0.6");
      expect(ruleBody(selector)).toContain(
        "--composer-context-chip-border:color-mix(",
      );
    }
  });

  it("declares the layout tokens", () => {
    expect(globalsCss).toContain(
      "--theme-layout-composer-context-chip-height: calc(3.25rem + 2px);",
    );
    expect(globalsCss).toContain(
      "--theme-layout-composer-context-area-max-height: 16.5rem;",
    );
    expect(globalsCss).toContain(
      "--theme-layout-composer-context-detail-width: 24rem;",
    );
  });
});
