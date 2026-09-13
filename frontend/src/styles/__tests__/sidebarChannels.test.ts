import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// SidebarBand and SidebarToggle put class names on elements and nothing else:
// every declaration they rely on lives here, and jsdom loads no CSS, so the
// component tests can only see that the classes are present. Two of the rules
// below are decided by SOURCE ORDER rather than specificity, which no
// component test can observe at all — reordering this file would leave the
// suite green while the add-in drawer's footer grew its padding back.
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

describe("sidebar chrome shape channels", () => {
  it("zeroes the flush band's padding after the skin declares it", () => {
    // Both selectors are specificity 0,1,0 and both set padding, so nothing
    // but source order separates them. The add-in carried `!p-0` for exactly
    // as long as its rule came first; putting the flush class back above the
    // skin would silently restore that defect.
    const skin = globalsCss.indexOf(".sidebar-section-skin {");
    const flush = globalsCss.indexOf(".sidebar-band-flush {");

    expect(skin).toBeGreaterThanOrEqual(0);
    expect(flush).toBeGreaterThan(skin);
    declares(".sidebar-band-flush", "padding", "0");
  });

  it("gives the floating skin an opaque base under the sidebar tone", () => {
    // A customer theme gives --theme-shell-sidebar 0.72 alpha and blurs it
    // through a backdrop-filter scoped to [data-ui="sidebar"]. The floating
    // toggles sit outside that element, so painting the token alone lets the
    // conversation show through the control. The flat gradient is what layers
    // the (possibly translucent) tone over an opaque shell colour; dropping it
    // for a plain background-color would reintroduce the see-through control.
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
    // The four inline `borderRadius` style objects this class replaced were
    // unreachable at any specificity, which is why a customer theme had to
    // re-declare --theme-radius-shell on the variant to bend them.
    expect(ruleBody(".floating-control-skin")).not.toMatch(
      /border-radius:\s*\d/,
    );
  });
});
