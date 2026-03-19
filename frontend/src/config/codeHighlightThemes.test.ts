import { describe, expect, it } from "vitest";

import {
  DEFAULT_DARK_CODE_HIGHLIGHT_PRESET,
  DEFAULT_LIGHT_CODE_HIGHLIGHT_PRESET,
  PRISM_CODE_THEME_PRESETS,
  PRISM_CODE_THEME_STYLES,
  resolvePrismCodeTheme,
} from "./codeHighlightThemes";

describe("codeHighlightThemes", () => {
  it("exposes the supported preset ids", () => {
    expect(PRISM_CODE_THEME_PRESETS).toEqual([
      "vs",
      "vsc-dark-plus",
      "one-light",
      "one-dark",
      "night-owl",
      "nord",
      "okaidia",
    ]);
  });

  it("resolves known preset ids to their Prism style objects", () => {
    expect(
      resolvePrismCodeTheme("one-dark", DEFAULT_DARK_CODE_HIGHLIGHT_PRESET),
    ).toBe(PRISM_CODE_THEME_STYLES["one-dark"]);
  });

  it("falls back to the provided default preset for invalid ids", () => {
    expect(
      resolvePrismCodeTheme(
        "not-a-real-theme",
        DEFAULT_LIGHT_CODE_HIGHLIGHT_PRESET,
      ),
    ).toBe(PRISM_CODE_THEME_STYLES.vs);
  });
});
