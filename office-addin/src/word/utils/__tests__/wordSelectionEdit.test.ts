import { describe, expect, it } from "vitest";

import {
  countWordReplaceFences,
  splitWordSelectionReplacement,
  WORD_REPLACE_FENCE,
  wordSelectionLinePieces,
} from "../wordSelectionEdit";

describe("countWordReplaceFences", () => {
  it("counts each opening replace fence, not its closing fence or other fences", () => {
    expect(
      countWordReplaceFences(
        [
          "Formal:",
          "```erato-word-replace",
          "One",
          "```",
          "Casual:",
          "  ~~~~ erato-word-replace",
          "Two",
          "  ~~~~",
          "```erato-word-replacement",
          "```text",
          "```",
        ].join("\n"),
      ),
    ).toBe(2);
  });

  it("finds none in prose that only names the fence", () => {
    expect(countWordReplaceFences("Use an erato-word-replace block.")).toBe(0);
  });
});

describe("splitWordSelectionReplacement", () => {
  it("uses the erato-word-replace fence", () => {
    expect(WORD_REPLACE_FENCE).toBe("erato-word-replace");
  });

  it("splits one line per paragraph after normalising CRLF and CR", () => {
    expect(
      splitWordSelectionReplacement("One\r\nTwo\rThree", "multi_paragraph", 3),
    ).toEqual({ lines: ["One", "Two", "Three"] });
  });

  it("keeps empty lines inside a multi-paragraph rewrite", () => {
    expect(
      splitWordSelectionReplacement("One\n\nThree", "multi_paragraph", 3),
    ).toEqual({ lines: ["One", "", "Three"] });
  });

  it("ignores one trailing newline", () => {
    expect(
      splitWordSelectionReplacement("One\nTwo\n", "multi_paragraph", 2),
    ).toEqual({ lines: ["One", "Two"] });
  });

  it.each([1, 2, 4])(
    "refuses a multi-paragraph rewrite with the wrong line count (%s for 3)",
    (count) => {
      expect(
        splitWordSelectionReplacement(
          Array.from({ length: count }, (_, i) => `Line ${i}`).join("\n"),
          "multi_paragraph",
          3,
        ),
      ).toEqual({ refused: "PARAGRAPH_COUNT_MISMATCH" });
    },
  );

  it.each(["inline", "paragraph", "table_cell"] as const)(
    "joins line breaks in a single-paragraph rewrite (%s)",
    (shape) => {
      expect(
        splitWordSelectionReplacement(
          "\nA rewritten \r\n  passage\n\nthat wraps\n",
          shape,
          1,
        ),
      ).toEqual({ lines: ["A rewritten passage that wraps"] });
    },
  );

  it("keeps the spaces of an inline rewrite", () => {
    expect(splitWordSelectionReplacement(" quick ", "inline", 1)).toEqual({
      lines: [" quick "],
    });
  });

  it.each(["", "\n", "  \r\n\t"])("refuses an empty fence %j", (content) => {
    expect(splitWordSelectionReplacement(content, "paragraph", 1)).toEqual({
      refused: "INVALID_REPLACEMENT",
    });
    expect(
      splitWordSelectionReplacement(content, "multi_paragraph", 1),
    ).toEqual({ refused: "INVALID_REPLACEMENT" });
  });

  it.each([
    "\u000B",
    "\u0002",
    "\u0005",
    "\u0007",
    "\f",
    "\u000E",
    "\u001E",
    "\u001F",
  ])("refuses the control character %j", (mark) => {
    expect(
      splitWordSelectionReplacement(`Text ${mark}here`, "paragraph", 1),
    ).toEqual({ refused: "INVALID_REPLACEMENT" });
  });

  it.each(["\u2028", "\u2029"])(
    "reads the separator %j as a newline, which Word would make a break",
    (separator) => {
      expect(
        splitWordSelectionReplacement(`A${separator}B`, "paragraph", 1),
      ).toEqual({ lines: ["A B"] });
      expect(
        splitWordSelectionReplacement(
          `A${separator}B\nC`,
          "multi_paragraph",
          2,
        ),
      ).toEqual({ refused: "PARAGRAPH_COUNT_MISMATCH" });
      expect(
        splitWordSelectionReplacement(`A${separator}B`, "multi_paragraph", 2),
      ).toEqual({ lines: ["A", "B"] });
    },
  );

  it("keeps tabs", () => {
    expect(splitWordSelectionReplacement("A\tB", "inline", 1)).toEqual({
      lines: ["A\tB"],
    });
  });
});

describe("wordSelectionLinePieces", () => {
  const paragraphs = [
    {
      kept: { markers: [{ number: 2, end: "point" as const }] },
      formats: { spans: [{ number: 1 }] },
    },
    { formats: { spans: [{ number: 3 }, { number: 4 }] } },
    {},
  ];

  it("gives each line's text without format markers, and the spans it dropped", () => {
    expect(
      wordSelectionLinePieces(paragraphs, [
        "A ⟦1⟧b⟦/1⟧ ⟦2⟧.",
        "C ⟦4⟧d⟦/4⟧.",
        "Plain.",
      ]),
    ).toEqual({
      lines: [
        {
          text: "A b ⟦2⟧.",
          pieces: ["A b ", "."],
          parts: [
            [
              { text: "A ", format: null },
              { text: "b", format: 1 },
              { text: " ", format: null },
            ],
            [{ text: ".", format: null }],
          ],
        },
        {
          text: "C d.",
          pieces: null,
          parts: [
            [
              { text: "C ", format: null },
              { text: "d", format: 4 },
              { text: ".", format: null },
            ],
          ],
        },
        {
          text: "Plain.",
          pieces: null,
          parts: [[{ text: "Plain.", format: null }]],
        },
      ],
      dropped: [3],
    });
  });

  it("refuses a span moved into another paragraph's line, and a marker in a line without any", () => {
    expect(
      wordSelectionLinePieces(paragraphs, ["A ⟦2⟧.", "⟦1⟧C⟦/1⟧.", "Plain."]),
    ).toEqual({ refused: "MARKERS_CHANGED" });
    expect(
      wordSelectionLinePieces(paragraphs, ["A ⟦2⟧.", "C.", "⟦3⟧P⟦/3⟧."]),
    ).toEqual({ refused: "MARKERS_CHANGED" });
  });
});
