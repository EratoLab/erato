import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ERATO_GEOMETRY_CLASS } from "../geometryClassNames";

// Comments are stripped first so a class named in prose cannot be read as a
// rule — `globals.css` documents several of these by name.
const globalsCss = readFileSync(
  join(process.cwd(), "src/styles/globals.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, " ");

/**
 * Marker classes that are declared API but have no rule of their own. Tailwind
 * generates `.group:hover` from the host's `group-hover:` variants, so a kit
 * wrapping host controls has to carry a literal `group`; nothing in
 * `globals.css` defines it.
 */
const NON_GLOBALS_MARKER_CLASSES = new Set(["group"]);

/**
 * Geometry classes that predate the layering convention and still sit after
 * `@layer components`. They are frozen as-is rather than fixed here: moving one
 * into the layer changes which caller utility wins, which is a visual change,
 * not a refactor. New geometry classes must go inside the layer.
 */
const GRANDFATHERED_UNLAYERED_GEOMETRY = new Set([
  "attachment-group-frame-geometry",
  "attachment-group-geometry",
  "attachment-group-header-geometry",
  "attachment-group-items-geometry",
  "list-row-geometry",
  "sidebar-band-geometry",
  "sidebar-content-col-geometry",
  "sidebar-icon-col-geometry",
  "sidebar-icon-col-geometry-avatar",
  "sidebar-icon-col-geometry-logo",
  "sidebar-inset-geometry",
  "sidebar-label-col-geometry",
  "sidebar-row-geometry",
  "sidebar-trailing-col-geometry",
  "thread-message-card-geometry",
]);

interface RuleHead {
  className: string;
  index: number;
}

/**
 * Every class named in a selector, with the offset it occurs at. A selector
 * prelude is any run of text with no brace in it that terminates in `{`, which
 * picks up multi-line selector lists and rules nested in at-rules alike;
 * at-rule preludes are skipped by their leading `@`.
 */
function ruleHeads(css: string): RuleHead[] {
  const heads: RuleHead[] = [];

  for (const rule of css.matchAll(/([^{}]*)\{/g)) {
    const prelude = rule[1];
    if (prelude.trim().startsWith("@")) {
      continue;
    }
    for (const selector of prelude.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) {
      heads.push({
        className: selector[1],
        index: rule.index + selector.index,
      });
    }
  }

  return heads;
}

/** Offsets of the `@layer components` block, found by brace depth. */
function componentsLayerRange(css: string): { start: number; end: number } {
  const start = css.indexOf("@layer components {");
  expect(start, "no @layer components block").toBeGreaterThanOrEqual(0);

  let depth = 0;
  for (let index = css.indexOf("{", start); index < css.length; index += 1) {
    if (css[index] === "{") {
      depth += 1;
    } else if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return { start, end: index };
      }
    }
  }

  throw new Error("unterminated @layer components block");
}

const heads = ruleHeads(globalsCss);
const layer = componentsLayerRange(globalsCss);
const classNames = Object.values(ERATO_GEOMETRY_CLASS);

describe("declared host class names", () => {
  it.each(
    classNames.filter(
      (className) => !NON_GLOBALS_MARKER_CLASSES.has(className),
    ),
  )("%s has a rule in globals.css", (className) => {
    expect(heads.map((head) => head.className)).toContain(className);
  });

  // The other direction. A `-geometry` or `-skin` suffix is what marks a class
  // as one of the two retune channels, so a new one is a host hook whether or
  // not anybody remembered to declare it — and an undeclared hook is invisible
  // to kits, themes and the add-in alike, which is the channel this record
  // exists to close.
  it("declares every suffixed rule head in globals.css", () => {
    const declared = new Set<string>(classNames);
    const channelled = [
      ...new Set(
        heads
          .map((head) => head.className)
          .filter(
            (className) =>
              className.includes("-geometry") || className.includes("-skin"),
          ),
      ),
    ];

    expect(channelled.length).toBeGreaterThan(0);
    expect(channelled.filter((className) => !declared.has(className))).toEqual(
      [],
    );
  });

  it("declares no duplicate class names", () => {
    expect(new Set(classNames).size).toBe(classNames.length);
  });

  // Geometry sets shape and must lose to a caller utility, so it lives in
  // @layer components. Skins paint and must outrank one, so they sit unlayered
  // after it. Source position is the whole mechanism and nothing else can see
  // it: jsdom loads no CSS.
  it("keeps new geometry classes inside @layer components", () => {
    const layered = classNames
      .filter((className) => className.includes("-geometry"))
      .filter((className) => !GRANDFATHERED_UNLAYERED_GEOMETRY.has(className));

    // A filter that silently empties would make the assertion below vacuous.
    expect(layered.length).toBeGreaterThan(0);

    const outside = layered.filter((className) =>
      heads.some(
        (head) =>
          head.className === className &&
          (head.index < layer.start || head.index > layer.end),
      ),
    );

    expect(outside).toEqual([]);
  });

  it("keeps every skin class after @layer components", () => {
    const skins = classNames.filter((className) => className.includes("-skin"));

    expect(skins.length).toBeGreaterThan(0);

    const tooEarly = skins.filter((className) =>
      heads.some(
        (head) => head.className === className && head.index < layer.end,
      ),
    );

    expect(tooEarly).toEqual([]);
  });

  it("grandfathers only geometry classes that are really unlayered", () => {
    // Keeps the allowlist from outliving its entries: once a class moves into
    // the layer, its exemption has to go with it.
    const stillOutside = [...GRANDFATHERED_UNLAYERED_GEOMETRY].filter(
      (className) =>
        heads.some(
          (head) =>
            head.className === className &&
            (head.index < layer.start || head.index > layer.end),
        ),
    );

    expect(stillOutside.sort()).toEqual(
      [...GRANDFATHERED_UNLAYERED_GEOMETRY].sort(),
    );
  });
});
