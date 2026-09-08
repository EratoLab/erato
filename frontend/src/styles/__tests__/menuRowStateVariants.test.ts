import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { describe, expect, it } from "vitest";

import tailwindConfig from "../../../tailwind.config";

// The `aria-expanded:` pair on the menu row replaced a per-call-site
// workaround, and jsdom resolves no Tailwind variant, so every component test
// can only see that the two classes are on the element. What made the
// workaround necessary — and what makes the pair a valid replacement — is the
// cascade: there is no `tailwind-merge` in this package, so the row's resting
// `text-theme-fg-secondary` stays on the element next to the expanded colour
// and one of them has to win on specificity rather than on order.
//
// Compiling the real config against a raw class list is the cheapest way to
// assert that in CI. The visible half — that the surface an expanded row paints
// is the panel's hover colour — is pinned by the `Row` play story.
const ROW_CLASSES = [
  "text-theme-fg-secondary",
  "aria-expanded:text-theme-fg-primary",
  "aria-expanded:bg-theme-bg-hover",
  "hover:bg-theme-bg-hover",
].join(" ");

async function compileUtilities(): Promise<string> {
  const result = await postcss([
    tailwindcss({
      ...tailwindConfig,
      content: [{ raw: ROW_CLASSES, extension: "html" }],
      corePlugins: { preflight: false },
    }),
  ]).process("@tailwind utilities;", { from: undefined });

  return result.css;
}

function selectorFor(css: string, className: string): string {
  const escaped = className.replace(/[:]/g, "\\\\$&");
  const match = new RegExp(`\\.${escaped}[^{]*\\{`).exec(css);

  expect(match, `no rule emitted for .${className}`).not.toBeNull();

  return match![0].replace(/\s*\{$/, "").trim();
}

describe("menu row state variants", () => {
  it("qualifies the expanded row's colours by attribute so they outrank the resting colour", async () => {
    const css = await compileUtilities();

    // (0,1,0): one class, nothing else.
    expect(selectorFor(css, "text-theme-fg-secondary")).toBe(
      ".text-theme-fg-secondary",
    );

    // (0,2,0): the class plus the attribute the row states on the same
    // element. Two of them beat one whatever order the sheet emits them in,
    // which is exactly the guarantee the deleted workaround was buying.
    for (const utility of [
      "aria-expanded:text-theme-fg-primary",
      "aria-expanded:bg-theme-bg-hover",
    ]) {
      expect(selectorFor(css, utility)).toBe(
        `.${utility.replace(/:/g, "\\:")}[aria-expanded="true"]`,
      );
    }

    // The expanded surface is the same token the row paints on hover, so an
    // open submenu row and a hovered row read alike.
    expect(css).toContain("--theme-bg-hover");
  });
});
