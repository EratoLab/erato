import { describe, expect, it } from "vitest";

import {
  parseWordOutline,
  WORD_OUTLINE_HEADER,
  WORD_OUTLINE_START_OF_DOCUMENT,
  wordOutlineLine,
  wordOutlineOmission,
} from "../wordOutlineFormat";

const entry = (
  ref: string,
  tag: "H" | "S" | "P",
  level: number,
  title: string,
) => wordOutlineLine({ ref, tag, level, title, kib: 1.25, paragraphs: 3 });
const text = (...lines: string[]) => [WORD_OUTLINE_HEADER, ...lines].join("\n");

describe("heading_outline text", () => {
  it("reads back the headings it lists, without the part before the first one", () => {
    expect(
      parseWordOutline(
        text(
          entry("b1", "H", 1, WORD_OUTLINE_START_OF_DOCUMENT),
          entry("b3", "H", 1, "1 Scope [draft]"),
          entry("b9", "S", 2, "1.1 Services"),
          entry("b20", "H", 2, "1.2 Fees"),
        ),
      ),
    ).toEqual({
      headings: new Map([
        ["b3", { level: 1, title: "1 Scope [draft]" }],
        ["b20", { level: 2, title: "1.2 Fees" }],
      ]),
      shortened: false,
    });
  });

  it("says when entries were left out and where a cut tail starts", () => {
    expect(
      parseWordOutline(
        text(entry("b3", "H", 1, "1 Scope"), wordOutlineOmission(4)),
      ),
    ).toEqual({ headings: expect.any(Map), shortened: true });
    expect(
      parseWordOutline(
        text(entry("b3", "H", 1, "1 Scope"), wordOutlineOmission(1, "b40")),
      ),
    ).toMatchObject({ shortened: true, endsBefore: "b40" });
  });

  it("refuses text in another format rather than guessing", () => {
    for (const other of [
      "",
      text("b3 H1 1 Scope"),
      text(wordOutlineOmission(2), entry("b3", "H", 1, "1 Scope")),
      ["Headings:", entry("b3", "H", 1, "1 Scope")].join("\n"),
    ])
      expect(parseWordOutline(other)).toBeUndefined();
  });
});
