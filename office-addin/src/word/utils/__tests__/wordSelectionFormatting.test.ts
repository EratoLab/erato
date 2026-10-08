import { afterEach, describe, expect, it } from "vitest";

import {
  installWordSelectionHost,
  uninstallWordSelectionHost,
} from "../../../test/mocks/word/selectionHost";
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

describe("a span whose first word alone carries a colour, highlight, font and size", () => {
  afterEach(uninstallWordSelectionHost);

  const rewrite = async (host: "mac" | "pc" | "web") => {
    const mock = installWordSelectionHost(
      {
        body: [
          {
            runs: [
              "MC1 ",
              {
                text: "Red",
                font: {
                  color: "#FF0000",
                  highlightColor: "Yellow",
                  name: "Courier New",
                  size: 20,
                },
              },
              " plain end.",
            ],
          },
        ],
      },
      { host },
    );
    await Word.run(async (context) => {
      const hits = context.document.body.paragraphs
        .getFirst()
        .search("Red plain", { matchCase: true });
      hits.load("items");
      await context.sync();
      hits.items[0].insertText("Rewritten", "Replace");
      await context.sync();
    });
    return mock.paragraphs()[0].runs;
  };

  it("is unresolved, because Replace gives it the first character's values on desktop and none on the web", async () => {
    const span: WordSelectionSpanFormat = Object.fromEntries(
      WORD_SELECTION_VALUE_PROPERTIES.map((property) => [
        property,
        { state: "mixed" },
      ]),
    );
    expect(wordSelectionTargetFormat(span, STYLE, true).unresolved).toEqual([
      ...WORD_SELECTION_VALUE_PROPERTIES,
    ]);
    const desktop = [
      { text: "MC1 " },
      {
        text: "Rewritten",
        font: {
          color: "#FF0000",
          highlightColor: "Yellow",
          name: "Courier New",
          size: 20,
        },
      },
      { text: " end." },
    ];
    expect(await rewrite("mac")).toEqual(desktop);
    expect(await rewrite("pc")).toEqual(desktop);
    expect(await rewrite("web")).toEqual([{ text: "MC1 Rewritten end." }]);
  });
});

describe("a span whose first word alone is bold with its complex-script twin", () => {
  afterEach(uninstallWordSelectionHost);

  const rewrite = async (requirements: "m365" | "ltsc2024") => {
    const bidiSetters = requirements === "m365";
    const { font } = wordSelectionTargetFormat(
      { bold: { state: "mixed" } },
      STYLE,
      bidiSetters,
    );
    const mock = installWordSelectionHost(
      {
        body: [
          {
            runs: [
              "BF1 ",
              { text: "Bold", font: { bold: true, boldBidirectional: true } },
              " plain end.",
            ],
          },
        ],
      },
      { host: "pc", requirements },
    );
    await Word.run(async (context) => {
      const hits = context.document.body.paragraphs
        .getFirst()
        .search("Bold plain", { matchCase: true });
      hits.load("items");
      await context.sync();
      const written = hits.items[0].insertText("Rewritten", "Replace");
      Object.assign(written.font, font);
      await context.sync();
    });
    return mock.paragraphs()[0].runs;
  };

  it("keeps the first character's bCs on LTSC 2024, which has no bidi setters, so such a twin is context only there", async () => {
    expect(await rewrite("m365")).toEqual([{ text: "BF1 Rewritten end." }]);
    expect(await rewrite("ltsc2024")).toEqual([
      { text: "BF1 " },
      { text: "Rewritten", font: { boldBidirectional: true } },
      { text: " end." },
    ]);
  });
});
