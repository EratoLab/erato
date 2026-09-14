/**
 * Pins every selector in ../themable-geometry.mjs. Two package configs consume
 * those selectors through one factory, so this test is what makes a change to
 * any of them visible.
 *
 * Vitest only collects *.test.{ts,tsx}, so this file has its own runner and
 * its own CI step:
 *   pnpm run test:eslint-rules
 */
import { RuleTester } from "eslint";
import { builtinRules } from "eslint/use-at-your-own-risk";

import {
  themableGeometryConfig,
  themableGeometryPrimitives,
  themableGeometrySelectors,
} from "../themable-geometry.mjs";

const [
  hookedUtilityLiteral,
  hookedUtilityTemplate,
  inlineRadius,
  primitiveUtility,
  frozenArbitrary,
] = themableGeometrySelectors;

let cases = 0;
RuleTester.describe = (_name, body) => body();
RuleTester.it = (_name, body) => {
  cases += 1;
  body();
};

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

const invalid = (code, entry) => ({
  code,
  options: themableGeometrySelectors,
  errors: [{ message: entry.message }],
});

ruleTester.run("themable-geometry", builtinRules.get("no-restricted-syntax"), {
  valid: [
    // A theme variable is the sanctioned way to round a hooked element.
    {
      code: '<div data-ui="chat.card" className="rounded-[var(--theme-radius-message)] p-2" />',
      options: themableGeometrySelectors,
    },
    // calc() over a theme variable still resolves through the theme.
    {
      code: '<div data-ui="chat.card" className="rounded-[calc(var(--theme-radius-message)_-_1px)]" />',
      options: themableGeometrySelectors,
    },
    {
      code: '<Card className="rounded-[max(var(--theme-radius-message),2px)]" />',
      options: themableGeometrySelectors,
    },
    // No hook, no promise to retune: a plain utility is fine.
    {
      code: '<div className="rounded-xl p-2" />',
      options: themableGeometrySelectors,
    },
    {
      code: '<Widget className="rounded-lg" />',
      options: themableGeometrySelectors,
    },
    // The documented blind spot of the inline-style selector.
    {
      code: '<div data-ui="chat.card" style={someStyleObject} />',
      options: themableGeometrySelectors,
    },
    {
      code: '<div data-ui="chat.card" style={{ padding: 8 }} />',
      options: themableGeometrySelectors,
    },
    // A render-prop nests a whole subtree inside the hooked opening element;
    // the utilities that subtree writes are not the hook's to answer for.
    {
      code: '<div data-ui="chat.card" render={() => <span className="rounded-md" />} />',
      options: themableGeometrySelectors,
    },
  ],
  invalid: [
    invalid(
      '<div data-ui="chat.card" className="rounded-xl p-2" />',
      hookedUtilityLiteral,
    ),
    // The hook also arrives as a component prop.
    invalid(
      '<Panel dataUi="chat.panel" className="rounded-full" />',
      hookedUtilityLiteral,
    ),
    invalid(
      '<div data-ui="chat.card" className={`p-2 ${gap} rounded-md`} />',
      hookedUtilityTemplate,
    ),
    invalid(
      '<div data-ui="chat.card" style={{ borderRadius: 8 }} />',
      inlineRadius,
    ),
    invalid(
      '<div data-ui="chat.card" style={{ "borderTopLeftRadius": "4px" }} />',
      inlineRadius,
    ),
    invalid('<Card className="rounded-xl" />', primitiveUtility),
    invalid("<Row className={`p-2 ${gap} rounded-md`} />", primitiveUtility),
    invalid(
      '<div data-ui="chat.card" className="rounded-[1rem]" />',
      frozenArbitrary,
    ),
    invalid('<SidebarBand className="rounded-[12px]" />', frozenArbitrary),
    invalid(
      '<div data-ui="chat.card" className="rounded-tl-[3px]" />',
      frozenArbitrary,
    ),
  ],
});

const assert = (condition, what) => {
  cases += 1;
  if (!condition) {
    throw new Error(`themable-geometry: ${what}`);
  }
};

assert(themableGeometrySelectors.length === 5, "expected 5 selectors");
assert(
  themableGeometryPrimitives.length === 9,
  "expected 9 primitive component names",
);
assert(
  themableGeometryConfig({ files: ["src/**/*.tsx"] }).rules[
    "no-restricted-syntax"
  ][0] === "error",
  "expected the factory to raise the rule to error",
);
assert(
  themableGeometryConfig({ files: ["a"], ignores: ["b"] }).ignores[0] === "b",
  "expected the factory to pass ignores through",
);
assert(
  themableGeometryConfig({ files: ["a"] }).ignores === undefined,
  "expected the factory to omit an empty ignores key",
);

console.log(`themable-geometry: ${cases} cases passed`);
