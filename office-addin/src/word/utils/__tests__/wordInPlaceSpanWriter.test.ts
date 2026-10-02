import { describe, expect, it } from "vitest";

import { planWordSpanEdits, wordSpanTokens } from "../wordInPlaceSpanWriter";

const PLAIN = { bold: false, italic: false, underline: false };
const run = (text: string, marks: Partial<typeof PLAIN> = {}) => ({
  text,
  ...PLAIN,
  ...marks,
});

describe("word-level span edits", () => {
  it("splits like getTextRanges on spaces", () => {
    expect(wordSpanTokens("The quick  fox.")).toEqual([
      "The ",
      "quick ",
      " ",
      "fox.",
    ]);
  });

  it("replaces only the changed word, next to the word before it", () => {
    const ranges = ["The ", "quick ", "fox."];
    expect(
      planWordSpanEdits(
        ranges,
        "The quick fox.",
        [run("The quick fox.")],
        [run("The slow fox.")],
      ),
    ).toEqual([
      {
        from: 1,
        to: 2,
        insert: [run("slow ")],
        anchor: { range: 0, location: "After", inherited: PLAIN },
      },
    ]);
  });

  it("inserts before the first kept word and keeps its marks as the starting point", () => {
    expect(
      planWordSpanEdits(
        ["Report ", "due."],
        "Report due.",
        [run("Report ", { bold: true }), run("due.")],
        [
          run("Final ", { italic: true }),
          run("Report ", { bold: true }),
          run("due."),
        ],
      ),
    ).toEqual([
      {
        from: 0,
        to: 0,
        insert: [run("Final ", { italic: true })],
        anchor: {
          range: 0,
          location: "Before",
          inherited: { ...PLAIN, bold: true },
        },
      },
    ]);
  });

  it("treats a word whose marks change as replaced", () => {
    expect(
      planWordSpanEdits(
        ["Keep ", "this."],
        "Keep this.",
        [run("Keep this.")],
        [run("Keep "), run("this.", { underline: true })],
      ),
    ).toEqual([
      {
        from: 1,
        to: 2,
        insert: [run("this.", { underline: true })],
        anchor: { range: 0, location: "After", inherited: PLAIN },
      },
    ]);
  });

  it("leaves the paragraph to a whole rewrite when ranges do not rejoin or no word survives", () => {
    const original = [run("Alpha beta")];
    expect(
      planWordSpanEdits(["Alpha", "beta"], "Alpha beta", original, [
        run("Alpha gamma"),
      ]),
    ).toBeUndefined();
    expect(
      planWordSpanEdits(["Alpha ", "beta"], "Alpha beta", original, [
        run("Gamma delta"),
      ]),
    ).toBeUndefined();
    expect(
      planWordSpanEdits(["Alpha ", "beta"], "Alpha betas", original, [
        run("Alpha gamma"),
      ]),
    ).toBeUndefined();
  });
});
