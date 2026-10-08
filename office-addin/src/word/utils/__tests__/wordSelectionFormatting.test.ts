import { describe, expect, it } from "vitest";

import {
  isUniformFontValue,
  WORD_SELECTION_BIDI_FONT_PROPERTIES,
  WORD_SELECTION_FONT_PROPERTIES,
  wordSelectionTargetFormat,
  wordSelectionTrackedFontProperties,
} from "../wordSelectionFormatting";

import type { WordSelectionFont } from "../wordSelectionFormatting";

const STYLE: WordSelectionFont = {
  bold: false,
  italic: false,
  underline: "None",
  strikeThrough: false,
  superscript: false,
  subscript: false,
  color: "#000000",
  highlightColor: null,
  name: "Calibri",
  size: 11,
  boldBidirectional: false,
  italicBidirectional: false,
  sizeBidirectional: 11,
  nameBidirectional: "Arial",
};

/** What Word reports for a span whose properties all vary. */
const MIXED: WordSelectionFont = {
  bold: null,
  italic: null,
  underline: "Mixed",
  strikeThrough: null,
  superscript: null,
  subscript: null,
  color: "",
  highlightColor: "",
  name: "",
  size: null,
  boldBidirectional: null,
  italicBidirectional: null,
  sizeBidirectional: null,
  nameBidirectional: null,
};

describe("wordSelectionTargetFormat", () => {
  it("keeps the values that were uniform across the span", () => {
    const span: WordSelectionFont = {
      ...STYLE,
      bold: true,
      color: "#FF0000",
      highlightColor: "Yellow",
      name: "Georgia",
      size: 14,
      underline: "Single",
    };
    expect(wordSelectionTargetFormat(span, STYLE, false)).toEqual({
      font: {
        bold: true,
        italic: false,
        underline: "Single",
        strikeThrough: false,
        superscript: false,
        subscript: false,
        color: "#FF0000",
        highlightColor: "Yellow",
        name: "Georgia",
        size: 14,
      },
      unresolved: [],
    });
  });

  it("takes the paragraph style's value where the span was mixed", () => {
    const { font, unresolved } = wordSelectionTargetFormat(MIXED, STYLE, true);
    expect(unresolved).toEqual([]);
    for (const property of wordSelectionTrackedFontProperties(true))
      expect(font[property]).toEqual(STYLE[property]);
  });

  it("bolds the whole rewrite only when the whole span was bold", () => {
    expect(
      wordSelectionTargetFormat({ ...STYLE, bold: null }, STYLE, false).font
        .bold,
    ).toBe(false);
    expect(
      wordSelectionTargetFormat({ ...STYLE, bold: true }, STYLE, false).font
        .bold,
    ).toBe(true);
  });

  it("treats a missing highlight as a uniform value", () => {
    expect(
      wordSelectionTargetFormat(
        { ...STYLE, highlightColor: null },
        { ...STYLE, highlightColor: "Yellow" },
        false,
      ).font.highlightColor,
    ).toBeNull();
  });

  it("sets the complex-script twins only where the host has their setters", () => {
    const without = wordSelectionTargetFormat(STYLE, STYLE, false).font;
    for (const property of WORD_SELECTION_BIDI_FONT_PROPERTIES)
      expect(without).not.toHaveProperty(property);
    const withSetters = wordSelectionTargetFormat(
      { ...STYLE, boldBidirectional: true },
      STYLE,
      true,
    ).font;
    expect(withSetters).toMatchObject({
      boldBidirectional: true,
      italicBidirectional: false,
      sizeBidirectional: 11,
      nameBidirectional: "Arial",
    });
  });

  it("reports properties neither the span nor the style resolves", () => {
    expect(
      wordSelectionTargetFormat(
        { ...MIXED },
        { ...STYLE, size: undefined, name: "" },
        false,
      ).unresolved,
    ).toEqual(["name", "size"]);
  });
});

describe("wordSelectionTrackedFontProperties", () => {
  it("tracks the WordApi 1.1 set, plus the twins with setters", () => {
    expect(wordSelectionTrackedFontProperties(false)).toEqual(
      WORD_SELECTION_FONT_PROPERTIES,
    );
    expect(wordSelectionTrackedFontProperties(true)).toEqual([
      ...WORD_SELECTION_FONT_PROPERTIES,
      ...WORD_SELECTION_BIDI_FONT_PROPERTIES,
    ]);
  });
});

describe("isUniformFontValue", () => {
  it.each([
    ["bold", null, false],
    ["bold", false, true],
    ["size", null, false],
    ["size", 12, true],
    ["underline", "Mixed", false],
    ["underline", null, false],
    ["underline", "None", true],
    ["color", "", false],
    ["color", "#000000", true],
    ["name", null, false],
    ["highlightColor", "", false],
    ["highlightColor", null, true],
    ["highlightColor", "#FFFF00", true],
    ["italic", undefined, false],
  ] as const)("%s = %j is uniform: %s", (property, value, uniform) => {
    expect(isUniformFontValue(property, value)).toBe(uniform);
  });
});
