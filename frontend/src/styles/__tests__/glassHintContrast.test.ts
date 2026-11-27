import { readFileSync } from "node:fs";
import { join } from "node:path";

import postcss from "postcss";
import { describe, expect, it } from "vitest";

import { darkTheme, defaultTheme } from "@/config/theme";

import type { Rule } from "postcss";

// jsdom paints nothing, so the contrast of hints on the glass is worked out
// here from the stylesheet's own values: the glass is the theme's surface over
// the chat background, let through at --glass-opacity over whatever scrolls
// under it; the hint is the muted colour mixed towards the text colour.
const root = postcss.parse(
  readFileSync(join(process.cwd(), "src/styles/globals.css"), "utf8"),
);

const normalise = (selector: string) => selector.replace(/\s+/g, " ").trim();

function declaration(selector: string, property: string): string {
  let value: string | undefined;
  root.walkRules((rule: Rule) => {
    // Increase Contrast's rule inside @media makes the glass solid.
    if (rule.parent !== root || normalise(rule.selector) !== selector) {
      return;
    }
    rule.walkDecls(property, (decl) => {
      value = decl.value;
    });
  });
  expect(value, `${property} on ${selector}`).toBeDefined();
  return value!;
}

const COMPOSER =
  ':where(html[data-system-glass][data-theme="dark"]) :where([data-ui="chat-conversation-shell"] [data-ui="chat-input-shell"]) textarea';
const opacity = Number(
  declaration("html[data-system-glass]", "--glass-opacity"),
);
const percent = (value: string) => Number.parseFloat(value) / 100;
const keep = {
  light: percent(declaration("html[data-system-glass]", "--glass-hint-keep")),
  darkMenu: percent(
    declaration(
      'html[data-system-glass][data-theme="dark"]',
      "--glass-hint-keep",
    ),
  ),
  darkComposer: percent(declaration(COMPOSER, "--glass-hint-keep")),
};

type Rgb = [number, number, number];
const rgb = (hex: string): Rgb => {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};
const mix = (a: Rgb, b: Rgb, shareOfA: number): Rgb =>
  a.map((channel, i) => shareOfA * channel + (1 - shareOfA) * b[i]) as Rgb;
const luminance = (color: Rgb) => {
  const [r, g, b] = color.map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];

interface Glass {
  surface: string;
  muted: string;
  primary: string;
  keep: number;
}

/** The hint's contrast over the glass with white and with black under it. */
function hintContrast({ surface, muted, primary, keep: share }: Glass) {
  const hint = mix(rgb(muted), rgb(primary), share);
  return Math.min(
    ...[WHITE, BLACK].map((content) =>
      contrast(hint, mix(rgb(surface), content, opacity)),
    ),
  );
}

const builtIn = (
  theme: typeof defaultTheme,
  surface: "chatInput" | "dropdown",
) => ({
  surface: theme.colors.shell[surface],
  muted: theme.colors.foreground.muted,
  primary: theme.colors.foreground.primary,
});

describe("hints on the glass", () => {
  it.each([
    [
      "the light composer",
      { ...builtIn(defaultTheme, "chatInput"), keep: keep.light },
    ],
    [
      "a light menu",
      { ...builtIn(defaultTheme, "dropdown"), keep: keep.light },
    ],
    ["a dark menu", { ...builtIn(darkTheme, "dropdown"), keep: keep.darkMenu }],
    // The shipped themes' hardest cases: a mid-grey hint on white, and on a
    // dark grey composer.
    [
      "a #888 hint on white",
      {
        surface: "#ffffff",
        muted: "#888888",
        primary: "#000000",
        keep: keep.light,
      },
    ],
    [
      "a #888 hint in a dark composer",
      {
        surface: "#2c2c2c",
        muted: "#888888",
        primary: "#ffffff",
        keep: keep.darkComposer,
      },
    ],
    [
      "a #888 hint in a dark menu",
      {
        surface: "#000000",
        muted: "#888888",
        primary: "#ffffff",
        keep: keep.darkMenu,
      },
    ],
  ])("reach 4.5:1 over white and black content in %s", (_, glass) => {
    expect(hintContrast(glass)).toBeGreaterThanOrEqual(4.5);
  });

  it("falls short only in the built-in dark composer, whose typed text itself barely passes, and doubles there", () => {
    const glass = builtIn(darkTheme, "chatInput");
    const typed = hintContrast({ ...glass, keep: 0 });
    const before = hintContrast({ ...glass, keep: 1 });

    expect(typed).toBeLessThan(5);
    expect(hintContrast({ ...glass, keep: keep.darkComposer })).toBeGreaterThan(
      2 * before - 0.1,
    );
  });

  it("stays the theme's own colour outside the app", () => {
    root.walkRules((rule: Rule) => {
      rule.walkDecls("--theme-fg-muted", (decl) => {
        if (decl.value.includes("--glass-fg-muted-base")) {
          expect(rule.selector).toContain("html[data-system-glass]");
        }
      });
    });
  });
});

// The round floating controls carry only a glyph and let more through; the
// glyph (the theme's secondary text colour) keeps the 3:1 a control's
// graphic needs over white and black content.
describe("glyphs on the round glass controls", () => {
  const controlOpacity = {
    light: Number(
      declaration("html[data-system-glass]", "--glass-control-opacity"),
    ),
    dark: Number(
      declaration(
        'html[data-system-glass][data-theme="dark"]',
        "--glass-control-opacity",
      ),
    ),
  };

  it.each([
    ["light", defaultTheme, controlOpacity.light],
    ["dark", darkTheme, controlOpacity.dark],
  ] as const)("reach 3:1 in the %s theme", (_, theme, share) => {
    const glyph = rgb(theme.colors.foreground.secondary);
    const surface = rgb(theme.colors.shell.chatInput);
    const worst = Math.min(
      ...[WHITE, BLACK].map((content) =>
        contrast(glyph, mix(surface, content, share)),
      ),
    );
    expect(worst).toBeGreaterThanOrEqual(3);
  });
});
