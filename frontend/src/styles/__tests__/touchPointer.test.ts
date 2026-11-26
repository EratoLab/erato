import { readFileSync } from "node:fs";
import { join } from "node:path";

import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { describe, expect, it } from "vitest";

import tailwindConfig from "../../../tailwind.config";

import type { AtRule, Rule } from "postcss";

const HOVERING = "(hover: hover) and (pointer: fine)";
const NOT_HOVERING = `not all and ${HOVERING}`;

const mediaOf = (rule: Rule) =>
  rule.parent?.type === "atrule" && (rule.parent as AtRule).name === "media"
    ? (rule.parent as AtRule).params
    : null;

const declarations = (rule: Rule) =>
  rule.nodes
    .map((node) => node.toString().replace(/\s+/g, ""))
    .sort()
    .join(";");

async function utilitiesFor(classes: string) {
  const result = await postcss([
    tailwindcss({
      ...tailwindConfig,
      content: [{ raw: `<div class="${classes}"></div>`, extension: "html" }],
    }),
  ]).process("@tailwind utilities;", { from: undefined });
  const rules: Rule[] = [];
  result.root.walkRules((rule) => {
    rules.push(rule);
  });
  return rules;
}

const selectorsOf = (rules: Rule[]) =>
  rules.map((rule) =>
    rule.selector
      .replace(/\\/g, "")
      .replace(/:where\(a\[href\].*?\[role="switch"\]\)/g, ":where(PRESSABLE)")
      .replace(/:is\(a\[href\].*?\[role="switch"\]\)/g, ":is(PRESSABLE)"),
  );

describe("hover styles on a touch screen", () => {
  it("limits `hover:` to a hovering pointer and shows it while a control is pressed elsewhere", async () => {
    const rules = await utilitiesFor("hover:underline");

    expect(rules.map(mediaOf)).toEqual([HOVERING, NOT_HOVERING, NOT_HOVERING]);
    expect(selectorsOf(rules)).toEqual([
      ".hover:underline:hover",
      ".hover:underline:where(PRESSABLE):active",
      ":where(:is(PRESSABLE):active) .hover:underline",
    ]);
  });

  it("names links, buttons and menu rows as pressable, not a plain container", async () => {
    const [, self] = await utilitiesFor("hover:underline");

    for (const control of ["a[href]", "button", '[role="menuitem"]']) {
      expect(self.selector).toContain(control);
    }
    expect(self.selector).not.toMatch(/\bdiv\b/);
    // A bare label would light a text field on every tap into it.
    expect(self.selector).not.toMatch(/[(,]\s*label\s*[,)]/);
    expect(self.selector).toContain('label:has(input[type="checkbox"]');
  });

  // Class names the app already uses, so this file adds nothing to the build.
  it("keeps `hover:` before `focus:` and `active:`, as the built-in variant sorts", async () => {
    const rules = await utilitiesFor(
      "active:scale-95 focus:opacity-100 hover:underline",
    );

    expect(selectorsOf(rules)).toEqual([
      ".hover:underline:hover",
      ".hover:underline:where(PRESSABLE):active",
      ":where(:is(PRESSABLE):active) .hover:underline",
      ".focus:opacity-100:focus",
      ".active:scale-95:active",
    ]);
  });

  it("limits `group-hover:` to a hovering pointer, with no pressed twin", async () => {
    const rules = await utilitiesFor("group-hover:opacity-100");

    expect(
      rules.map((rule) => [mediaOf(rule), rule.selector.replace(/\\/g, "")]),
    ).toEqual([[HOVERING, ".group:hover .group-hover:opacity-100"]]);
  });

  it("shows `no-hover:` styles only without a hovering pointer", async () => {
    const [rule] = await utilitiesFor("no-hover:opacity-100");

    expect(mediaOf(rule)).toBe(NOT_HOVERING);
  });

  it("gives every hover rule in globals.css a pressed twin for touch", () => {
    const root = postcss.parse(
      readFileSync(join(process.cwd(), "src/styles/globals.css"), "utf8"),
    );
    const hoverRules: Rule[] = [];
    const activeRules: Rule[] = [];
    root.walkRules((rule) => {
      if (mediaOf(rule) === NOT_HOVERING && rule.selector.includes(":active")) {
        activeRules.push(rule);
      }
      // A scrollbar thumb is only ever reached with a pointer.
      if (
        rule.selector.includes(":hover") &&
        !/scrollbar/.test(rule.selector)
      ) {
        hoverRules.push(rule);
      }
    });

    expect(hoverRules.length).toBeGreaterThan(0);
    for (const rule of hoverRules) {
      expect(mediaOf(rule), rule.selector).toBe(HOVERING);
      const twin = activeRules.find(
        (active) =>
          active.selector === rule.selector.replaceAll(":hover", ":active"),
      );
      expect(twin, rule.selector).toBeDefined();
      expect(declarations(twin!)).toBe(declarations(rule));
    }
  });
});

describe("holding a finger on a control", () => {
  it("does not select a control's label without a hovering pointer, but leaves links selectable", async () => {
    const result = await postcss([
      tailwindcss({
        ...tailwindConfig,
        content: [{ raw: "<div></div>", extension: "html" }],
      }),
    ]).process("@tailwind base;", { from: undefined });
    const unselectable: Rule[] = [];
    result.root.walkRules((rule) => {
      if (
        rule.selector.includes("button") &&
        rule.nodes.some((node) => node.toString() === "user-select: none")
      ) {
        unselectable.push(rule);
      }
    });

    expect(unselectable).toHaveLength(1);
    const [rule] = unselectable;
    expect(mediaOf(rule)).toBe(NOT_HOVERING);
    for (const control of ["button", '[role="menuitem"]', '[role="option"]']) {
      expect(rule.selector).toContain(control);
    }
    expect(rule.selector).not.toContain("a[href]");
    expect(rule.selector).not.toContain('[role="link"]');
  });
});

describe("the touch-phone variant", () => {
  it("applies on a narrow screen without a hovering pointer only", async () => {
    const result = await postcss([
      tailwindcss({
        ...tailwindConfig,
        content: [
          {
            raw: '<div class="touch-phone:text-base"></div>',
            extension: "html",
          },
        ],
      }),
    ]).process("@tailwind utilities;", { from: undefined });
    const rules: Rule[] = [];
    result.root.walkRules((rule) => {
      rules.push(rule);
    });

    expect(rules).toHaveLength(1);
    const inner = rules[0].parent as AtRule;
    const outer = inner.parent as AtRule;
    expect([outer.params, inner.params]).toEqual([
      "(max-width: 639.98px)",
      NOT_HOVERING,
    ]);
  });
});
