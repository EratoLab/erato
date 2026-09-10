import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// The attachment frames are cards, but three things stay in this stylesheet:
// the input corner the group reads instead of the card one, the padding its
// two layouts need, and the corner an attachment chip inside a thread reads.
// jsdom loads no CSS, so the component tests can only see the class names.
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
  const match = new RegExp(`(?:^| )${escaped} \\{([^}]*)\\}`).exec(globalsCss);

  expect(match, `no rule for ${selector}`).not.toBeNull();

  return match![1].replace(/\s/g, "");
}

function declares(selector: string, property: string, value: string): void {
  expect(ruleBody(selector)).toContain(
    `${property}:${value.replace(/\s/g, "")};`,
  );
}

describe("attachment group and thread card channels", () => {
  it("holds the whole family outside the components layer", () => {
    // Unlayered is what makes the padding beat a caller's utility, which both
    // group layouts depend on, and what leaves a customer theme.css free to
    // retune any of it through the data-ui hooks. Indentation is what says so
    // in this file, so it is what is pinned.
    for (const selector of [
      "\\.attachment-group-geometry",
      "\\.attachment-group-frame-geometry",
      "\\.attachment-group-header-geometry",
      "\\.attachment-group-items-geometry",
      "\\.thread-message-card-geometry",
    ]) {
      expect(rawCss).toMatch(new RegExp(`^${selector} \\{`, "m"));
    }
  });

  it("gives the group frame the input corner through the card channel", () => {
    // A published retune: theming.mdx tells a customer to move this frame with
    // radius.input, and the card family reads the corner from this variable.
    declares(
      ".attachment-group-geometry",
      "--card-radius",
      "var(--theme-radius-input)",
    );
  });

  it("pads both group layouts from the card's own inset", () => {
    declares(
      ".attachment-group-frame-geometry",
      "padding",
      "var(--card-inset)",
    );
    declares(
      ".attachment-group-header-geometry",
      "padding",
      "var(--card-inset) var(--card-inset) 0.5rem",
    );
    declares(
      ".attachment-group-items-geometry",
      "padding",
      "0.5rem var(--card-inset) var(--card-inset)",
    );
  });

  it("closes a collapsed group on the frame's own border", () => {
    declares(
      '.attachment-group-header-geometry[aria-expanded="false"]',
      "border-bottom-width",
      "0",
    );
  });

  it("lets the sticky group header travel the whole frame", () => {
    // A sticky element moves inside its containing block, and the band a card
    // wraps a header slot in is exactly as tall as the header.
    declares(
      '[data-ui="attachment-group"] > [data-ui="card-header"]',
      "display",
      "contents",
    );
  });

  it("keeps both attachment tile floors above zero", () => {
    // Not a guard against exotic themes: at stock the group corner is 1rem and
    // its inset 0.75rem, so the thread card lands on 0.25rem and both
    // derivations below go negative. On the family's plain max(0px, …) every
    // chip and every icon plate inside a thread would come out square.
    declares(
      ".thread-message-card-geometry",
      "--attachment-tile-radius",
      "max(0.25rem, var(--card-radius) - var(--card-inset))",
    );
    declares(
      ".thread-message-card-geometry",
      "--attachment-tile-icon-radius",
      "max(0.125rem, var(--attachment-tile-radius) - 0.5rem)",
    );
    expect(ruleBody(".thread-message-card-geometry")).not.toContain("max(0px");
  });
});

describe("attachment chip channels", () => {
  // The other half of the derivation above. A chip reads what a frame around
  // it declares, so the two are one contract: a default on either read below
  // would shadow the card's value, and every probe that measures a chip
  // standing on its own would keep passing while the retune moved nothing.
  it("reads both tile corners without declaring either", () => {
    declares(
      ".attachment-tile-geometry",
      "border-radius",
      "var(--attachment-tile-radius, var(--theme-radius-base))",
    );
    // A read names the variable before a comma; only a declaration follows it
    // with a colon.
    expect(ruleBody(".attachment-tile-geometry")).not.toContain(
      "--attachment-tile-radius:",
    );

    declares(
      ".attachment-tile-icon-geometry",
      "border-radius",
      "var(--attachment-tile-icon-radius, var(--theme-radius-base))",
    );
    expect(ruleBody(".attachment-tile-icon-geometry")).not.toContain(
      "--attachment-tile-icon-radius:",
    );
  });

  it("keeps the corner badge a circle no radius token can square", () => {
    declares(".attachment-badge-geometry", "border-radius", "50%");
  });

  it("dilutes the icon plate's tint rather than pinning a colour", () => {
    declares(
      ".attachment-tile-icon-skin",
      "color",
      "var(--attachment-tile-icon-tint)",
    );
    declares(
      ".attachment-tile-icon-skin",
      "background-color",
      "color-mix(in srgb, var(--attachment-tile-icon-tint) 12%, transparent)",
    );
  });
});
