/**
 * Shared `no-restricted-syntax` selectors that keep corner radius themable.
 *
 * The frontend and the Office add-in both render the same surfaces, so both
 * packages import this module rather than keeping hand-synchronised copies of
 * the selector strings. Each package still chooses its own `files`/`ignores`,
 * because their source layouts differ.
 */

/**
 * Components that own a `data-ui` hook on the element they render and forward a
 * caller `className` onto that same element. A rounding utility passed in from a
 * call site lands on the hooked element, where selectors 1 and 2 can no longer
 * see it — the hook lives in the component file, the utility in the caller.
 */
export const themableGeometryPrimitives = [
  "AttachmentNotice",
  "AttachmentTile",
  "Card",
  "PopoverPanel",
  "Row",
  "SidebarBand",
  "SidebarToggle",
  "SpinnerIcon",
  "TabRail",
];

const hookedElement =
  "JSXOpeningElement:has(JSXAttribute[name.name=/^(data-ui|dataUi)$/])";

const primitiveElement = `JSXOpeningElement[name.name=/^(${themableGeometryPrimitives.join("|")})$/]`;

/** A Tailwind rounding utility that resolves to a fixed scale step. */
const fixedScaleUtility = String.raw`(^|\s)rounded(?!-\[)(-(t|b|l|r|tl|tr|bl|br|s|e|ss|se|es|ee))?(-(none|sm|md|lg|xl|2xl|3xl|full))?(\s|$)`;

/**
 * An arbitrary rounding value that does not read anything at runtime. A value
 * opening with `var(`, `calc(`, `max(` or `min(` can still resolve to a theme
 * variable, so only the rest is a dead end.
 */
const frozenArbitraryValue = String.raw`(^|\s)rounded(-(t|b|l|r|tl|tr|bl|br|s|e|ss|se|es|ee))?-\[(?!(var|calc|max|min)\()`;

const utilityMessage =
  "Elements carrying a data-ui hook take their corner radius from a token-reading class or a rounded-[var(--theme-radius-…)] value, never a Tailwind rounded-* utility, so customer themes can retune them.";

export const themableGeometrySelectors = [
  // A data-ui hook promises a theme it can retune the surface. A Tailwind
  // rounding utility on the same element would sit outside every token and
  // geometry class, so the corner has to come from one of those. The hook
  // arrives as the attribute or through a component's `dataUi` prop, so both
  // spellings are guarded. `className` has to be a direct child of the opening
  // element: a render-prop attribute nests whole JSX subtrees in that same
  // element, and a descendant match blames the hook for the utilities those
  // subtrees write.
  {
    selector: `${hookedElement} > JSXAttribute[name.name="className"] Literal[value=/${fixedScaleUtility}/]`,
    message: utilityMessage,
  },
  {
    selector: `${hookedElement} > JSXAttribute[name.name="className"] TemplateElement[value.raw=/${fixedScaleUtility}/]`,
    message: utilityMessage,
  },
  {
    selector: [
      `${hookedElement} > JSXAttribute[name.name="style"] > JSXExpressionContainer > ObjectExpression > Property[key.name=/^border[A-Za-z]*Radius$/]`,
      `${hookedElement} > JSXAttribute[name.name="style"] > JSXExpressionContainer > ObjectExpression > Property[key.value=/^border[A-Za-z]*Radius$/]`,
    ].join(", "),
    message:
      "Elements carrying a data-ui hook take their corner radius from a token-reading class, not an inline borderRadius, which no customer theme can reach. This only catches a radius written literally in the style object — a spread or a variable such as style={someStyleObject} is invisible to it, so it holds the line going forward rather than proving the surface clean.",
  },
  {
    selector: [
      `${primitiveElement} > JSXAttribute[name.name="className"] Literal[value=/${fixedScaleUtility}/]`,
      `${primitiveElement} > JSXAttribute[name.name="className"] TemplateElement[value.raw=/${fixedScaleUtility}/]`,
    ].join(", "),
    message:
      "This component renders its own data-ui hook and forwards className onto the hooked element, so a Tailwind rounded-* utility here overrides the theme from outside. Pass a token-reading class or a rounded-[var(--theme-radius-…)] value, or change the component's own geometry.",
  },
  {
    selector: [
      `${hookedElement} > JSXAttribute[name.name="className"] Literal[value=/${frozenArbitraryValue}/]`,
      `${hookedElement} > JSXAttribute[name.name="className"] TemplateElement[value.raw=/${frozenArbitraryValue}/]`,
      `${primitiveElement} > JSXAttribute[name.name="className"] Literal[value=/${frozenArbitraryValue}/]`,
      `${primitiveElement} > JSXAttribute[name.name="className"] TemplateElement[value.raw=/${frozenArbitraryValue}/]`,
    ].join(", "),
    message:
      "An arbitrary rounded-[…] value on a themable element has to resolve through a theme variable. Open it with var(, calc(, max( or min( — rounded-[1rem] freezes the corner at a length no theme can reach.",
  },
];

/**
 * Builds the flat-config object that applies the selectors. Both packages go
 * through this factory so severity and rule name cannot drift either.
 *
 * @param {{ files: string[], ignores?: string[] }} scope
 * @returns {import("eslint").Linter.FlatConfig}
 */
export function themableGeometryConfig({ files, ignores }) {
  return {
    files,
    ...(ignores ? { ignores } : {}),
    rules: {
      "no-restricted-syntax": ["error", ...themableGeometrySelectors],
    },
  };
}
