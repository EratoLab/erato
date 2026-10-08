import { describe, expect, it } from "vitest";

import {
  WORD_SELECTION_TOGGLE_PROPERTIES,
  WORD_SELECTION_VALUE_PROPERTIES,
  wordSelectionTargetFormat,
} from "../wordSelectionFormatting";

import type {
  WordSelectionFont,
  WordSelectionSpanFormat,
} from "../wordSelectionFormatting";

/** Normal after docDefaults, as resolved from the styles part. */
const STYLE: WordSelectionFont = {
  bold: false,
  italic: false,
  underline: "None",
  strikeThrough: false,
  superscript: false,
  subscript: false,
};

const HEADING: WordSelectionFont = { ...STYLE, bold: true };

const MIXED_TOGGLES: WordSelectionSpanFormat = Object.fromEntries(
  WORD_SELECTION_TOGGLE_PROPERTIES.map((property) => [
    property,
    { state: "mixed" },
  ]),
);

describe("wordSelectionTargetFormat", () => {
  it("sets nothing for a plain span, so every host keeps what the style gives", () => {
    expect(wordSelectionTargetFormat({}, STYLE, true)).toEqual({
      font: {},
      unresolved: [],
    });
    expect(wordSelectionTargetFormat({}, HEADING, false)).toEqual({
      font: {},
      unresolved: [],
    });
  });

  it("sets again what the span set directly on every run", () => {
    expect(
      wordSelectionTargetFormat(
        {
          bold: { state: "direct", value: true },
          italic: { state: "direct", value: false },
          underline: { state: "direct", value: "Single" },
          color: { state: "direct", value: "#FF0000" },
          highlightColor: { state: "direct", value: "Yellow" },
          name: { state: "direct", value: "Georgia" },
          size: { state: "direct", value: 14 },
        },
        STYLE,
        true,
      ),
    ).toEqual({
      font: {
        bold: true,
        italic: false,
        underline: "Single",
        color: "#FF0000",
        highlightColor: "Yellow",
        name: "Georgia",
        size: 14,
      },
      unresolved: [],
    });
  });

  it("gives mixed toggles the paragraph style's value", () => {
    expect(wordSelectionTargetFormat(MIXED_TOGGLES, HEADING, false)).toEqual({
      font: { ...HEADING },
      unresolved: [],
    });
  });

  it.each(WORD_SELECTION_VALUE_PROPERTIES)(
    "reports a mixed %s as unresolved, since desktop would copy the first character's value",
    (property) => {
      expect(
        wordSelectionTargetFormat(
          { bold: { state: "mixed" }, [property]: { state: "mixed" } },
          { ...STYLE, color: "#000000", name: "Calibri", size: 11 },
          true,
        ),
      ).toEqual({
        font: { bold: false, boldBidirectional: false },
        unresolved: [property],
      });
    },
  );

  it("also sets the bold and italic twins of a mixed span where the host has their setters", () => {
    expect(
      wordSelectionTargetFormat(
        { bold: { state: "mixed" }, italic: { state: "mixed" } },
        STYLE,
        true,
      ).font,
    ).toEqual({
      bold: false,
      boldBidirectional: false,
      italic: false,
      italicBidirectional: false,
    });
    expect(
      wordSelectionTargetFormat({ bold: { state: "mixed" } }, STYLE, false)
        .font,
    ).toEqual({ bold: false });
  });

  it("never sets a twin for a uniform span", () => {
    expect(
      wordSelectionTargetFormat(
        { bold: { state: "direct", value: true } },
        STYLE,
        true,
      ).font,
    ).toEqual({ bold: true });
  });

  it("reports mixed toggles the style gives no value for", () => {
    expect(
      wordSelectionTargetFormat(
        MIXED_TOGGLES,
        { ...STYLE, bold: null, subscript: undefined },
        false,
      ).unresolved,
    ).toEqual(["bold", "subscript"]);
  });
});
