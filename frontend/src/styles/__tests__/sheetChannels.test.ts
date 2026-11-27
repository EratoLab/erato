import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// jsdom loads no CSS, so ModalBase's tests only see `data-sheet`. What makes
// it a sheet on a phone (safe areas, the open keyboard, reduced motion) and
// the in-app settings look live here.
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

const SHEET_OVERLAY = ".modal-overlay-skin:where([data-sheet])";
const SHEET_FRAME = ".modal-shell-frame-geometry:where([data-sheet])";
const SHEET_SKIN = ".modal-shell-skin:where([data-sheet])";

describe("bottom sheet rules", () => {
  it("sit after the utilities, so a caller's max-w-* cannot narrow a sheet", () => {
    const utilities = globalsCss.indexOf("@tailwind utilities");
    for (const selector of [SHEET_OVERLAY, SHEET_FRAME, SHEET_SKIN]) {
      expect(ruleIndex(selector)).toBeGreaterThan(utilities);
    }
    expect(ruleBody(SHEET_FRAME)).toContain("max-width:none;");
  });

  it("keep clear of the home indicator, which an open keyboard covers", () => {
    expect(ruleBody(SHEET_FRAME)).toContain(
      "padding-bottom:var(--safe-area-bottom);",
    );
    expect(ruleBody(':root[data-virtual-keyboard="open"]')).toContain(
      "--safe-area-bottom:0px;",
    );
    expect(ruleBody(SHEET_OVERLAY)).toContain(
      "padding:calc(var(--safe-area-top)+0.5rem)var(--safe-area-right)0var(--safe-area-left);",
    );
  });

  it("round the top corners only, from the theme's modal radius", () => {
    expect(ruleBody(SHEET_SKIN)).toContain(
      "border-radius:var(--theme-radius-modal)var(--theme-radius-modal)00;",
    );
  });

  it("do not slide under reduced motion", () => {
    const block = globalsCss.indexOf(
      `@media (prefers-reduced-motion: reduce) { ${SHEET_OVERLAY}, ${SHEET_SKIN} {`,
    );
    expect(block).toBeGreaterThanOrEqual(0);
    expect(globalsCss.slice(block, globalsCss.indexOf("}", block))).toContain(
      "animation: none;",
    );
  });
});

describe("in-app settings look", () => {
  it("applies only inside an app with system glass", () => {
    for (const selector of [
      ':where(html[data-system-glass]) .modal-overlay-skin[data-placement="fullscreen"], :where(html[data-system-glass]) .modal-shell-skin:where([data-placement="fullscreen"])',
      ':where(html[data-system-glass]) [data-ui="settings-page-list"]',
      ':where(html[data-system-glass]) [data-ui="settings-page"]',
    ]) {
      ruleIndex(selector);
    }
    expect(globalsCss).not.toMatch(/(^|[},]) ?\[data-ui="settings-page"\] \{/);
  });

  it("keeps a theme's own corners when it opts out of system shapes", () => {
    expect(globalsCss).toContain(
      ":where(html[data-system-glass]) { --settings-group-radius: var(--theme-radius-card); }",
    );
    expect(globalsCss).toContain(
      ':where(html[data-system-glass]:not([data-theme-shapes="theme"])) { --settings-group-radius: 26px; }',
    );
  });
});
