import type { Config } from "tailwindcss";
import defaultTheme from "tailwindcss/defaultTheme";
import plugin from "tailwindcss/plugin";

import { HOVERING_POINTER } from "./src/styles/pointerQueries";

const NO_HOVERING_POINTER = `not all and ${HOVERING_POINTER}`;

/**
 * What a tap acts on. Plain surfaces stay out: a finger that scrolls over a
 * message presses it too. A label only counts around a check or radio box;
 * around a text field it would light the field on every tap into it.
 */
const PRESSABLE = [
  "a[href]",
  "button",
  'label:has(input[type="checkbox"], input[type="radio"])',
  "summary",
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="option"]',
  '[role="tab"]',
  '[role="switch"]',
].join(", ");

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    // The add-in ships no Tailwind build of its own — it renders against this
    // stylesheet (`@erato/frontend/library.css`). Without this glob a utility
    // the add-in uses but the frontend does not is simply never emitted, and
    // the add-in renders unstyled with no build error. A missing directory
    // matches nothing, so a standalone frontend build is unaffected.
    "../office-addin/src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "var(--theme-font-body, 'Geist Variable')",
          ...defaultTheme.fontFamily.sans,
        ],
        heading: [
          "var(--theme-font-heading, 'Geist Variable')",
          ...defaultTheme.fontFamily.sans,
        ],
        "body-semibold": [
          "var(--theme-font-semibold, var(--theme-font-body, 'Geist Variable'))",
          ...defaultTheme.fontFamily.sans,
        ],
        "heading-bold": [
          "var(--theme-font-heading-bold, var(--theme-font-heading, 'Geist Variable'))",
          ...defaultTheme.fontFamily.sans,
        ],
        mono: [
          "var(--theme-font-mono, 'Geist Mono Variable')",
          ...defaultTheme.fontFamily.mono,
        ],
      },
      fontSize: {
        xs: [
          "var(--theme-font-size-xs)",
          {
            lineHeight: "var(--theme-line-height-xs)",
            letterSpacing: "var(--theme-letter-spacing-xs)",
          },
        ],
        sm: [
          "var(--theme-font-size-sm)",
          {
            lineHeight: "var(--theme-line-height-sm)",
            letterSpacing: "var(--theme-letter-spacing-sm)",
          },
        ],
        base: [
          "var(--theme-font-size-base)",
          {
            lineHeight: "var(--theme-line-height-base)",
            letterSpacing: "var(--theme-letter-spacing-base)",
          },
        ],
        lg: [
          "var(--theme-font-size-lg)",
          {
            lineHeight: "var(--theme-line-height-lg)",
            letterSpacing: "var(--theme-letter-spacing-lg)",
          },
        ],
        xl: [
          "var(--theme-font-size-xl)",
          {
            lineHeight: "var(--theme-line-height-xl)",
            letterSpacing: "var(--theme-letter-spacing-xl)",
          },
        ],
        "2xl": [
          "var(--theme-font-size-2xl)",
          {
            lineHeight: "var(--theme-line-height-2xl)",
            letterSpacing: "var(--theme-letter-spacing-2xl)",
          },
        ],
      },
      fontWeight: {
        normal: "var(--theme-font-weight-normal)",
        medium: "var(--theme-font-weight-medium)",
        semibold: "var(--theme-font-weight-semibold)",
        bold: "var(--theme-font-weight-bold)",
      },
      colors: {
        theme: {
          bg: {
            primary: "var(--theme-bg-primary)",
            secondary: "var(--theme-bg-secondary)",
            tertiary: "var(--theme-bg-tertiary)",
            sidebar: "var(--theme-bg-sidebar)",
            accent: "var(--theme-bg-accent)",
            hover: "var(--theme-bg-hover)",
            selected: "var(--theme-bg-selected)",
          },
          fg: {
            primary: "var(--theme-fg-primary)",
            secondary: "var(--theme-fg-secondary)",
            muted: "var(--theme-fg-muted)",
            accent: "var(--theme-fg-accent)",
          },
          action: {
            primary: {
              bg: "var(--theme-action-primary-bg)",
              fg: "var(--theme-action-primary-fg)",
              hover: "var(--theme-action-primary-hover)",
            },
          },
          border: {
            DEFAULT: "var(--theme-border)",
            primary: "var(--theme-border-primary, var(--theme-border))",
            strong: "var(--theme-border-strong)",
            focus: "var(--theme-border-focus)",
          },
          avatar: {
            user: {
              bg: "var(--theme-avatar-user-bg)",
              fg: "var(--theme-avatar-user-fg)",
            },
            assistant: {
              bg: "var(--theme-avatar-assistant-bg)",
              fg: "var(--theme-avatar-assistant-fg)",
            },
          },
          code: {
            inline: {
              bg: "var(--theme-code-inline-bg)",
              fg: "var(--theme-code-inline-fg)",
              border: "var(--theme-code-inline-border)",
            },
            block: {
              bg: "var(--theme-code-block-bg)",
              fg: "var(--theme-code-block-fg)",
              border: "var(--theme-code-block-border)",
            },
          },
          info: {
            fg: "var(--theme-info-fg)",
            bg: "var(--theme-info-bg)",
            border: "var(--theme-info-border)",
          },
          success: {
            fg: "var(--theme-success-fg)",
            bg: "var(--theme-success-bg)",
            border: "var(--theme-success-border)",
          },
          warning: {
            fg: "var(--theme-warning-fg)",
            bg: "var(--theme-warning-bg)",
            border: "var(--theme-warning-border)",
          },
          error: {
            fg: "var(--theme-error-fg)",
            bg: "var(--theme-error-bg)",
            border: "var(--theme-error-border)",
          },
          focus: {
            ring: "var(--theme-focus-ring)",
          },
        },
      },
      ringColor: {
        theme: {
          focus: "var(--theme-focus-ring)",
          "focus-error": "var(--theme-focus-ring-error)",
          // Faint 1px ring for the keyboard-active dropdown/menu row — a soft
          // "active" affordance distinct from the heavier focus ring.
          "border-dropdown": "var(--theme-border-dropdown)",
          "error-border": "var(--theme-error-border)",
        },
      },
    },
  },
  // `group-hover:` and `peer-hover:` apply only under a hovering pointer. A
  // touch screen keeps :hover on whatever was tapped last, and a tap that
  // reveals hover content is taken by the browser as the hover alone, so the
  // control under the finger gets no click.
  future: {
    hoverOnlyWhenSupported: true,
  },
  plugins: [
    plugin(({ addBase, addVariant }) => {
      // Without a hovering pointer, `hover:` styles show while a control (or
      // what sits inside one) is pressed: the feedback a tap otherwise lacks,
      // and nothing left behind once the finger lifts. On the control itself
      // :where() keeps the specificity of `&:hover`; inside a pressed control
      // it is one class lower, so a state rule such as `aria-pressed:` wins
      // there. `before` keeps the variant where the built-in one sorts, so the
      // cascade with `focus:`/`active:` holds. It is not in Tailwind's public
      // types; touchPointer.test.ts fails if an upgrade stops honouring it
      // (Tailwind 4 replaces all of this with `@custom-variant`).
      addVariant(
        "hover",
        [
          `@media ${HOVERING_POINTER} { &:hover }`,
          `@media ${NO_HOVERING_POINTER} { &:where(${PRESSABLE}):active }`,
          `@media ${NO_HOVERING_POINTER} { :where(:is(${PRESSABLE}):active) & }`,
        ],
        // @ts-expect-error -- `before` is honoured but not in the public type.
        { before: ["focus"] },
      );
      // For what a hovering pointer would reveal and a touch screen shows.
      addVariant("no-hover", `@media ${NO_HOVERING_POINTER}`);
      // The pressed look shows at once, as a phone's own controls do; letting
      // go still fades it out.
      addBase({
        [`@media ${NO_HOVERING_POINTER}`]: {
          [`:is(${PRESSABLE}):active, :is(${PRESSABLE}):active *`]: {
            transitionDuration: "0s",
          },
        },
      });
    }),
  ],
} satisfies Config;
