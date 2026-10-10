import { describe, expect, it } from "vitest";

import {
  markWordParagraphOoxml,
  WORD_FORMAT_SPANS_MAX,
  wordEmphasisFont,
  wordEmphasisWords,
} from "../wordSelectionFormatSpans";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const pkg = (paragraph: string) =>
  `<?xml version="1.0" standalone="yes"?><pkg:package xmlns:pkg="http://schemas.microsoft.com/office/2006/xmlPackage"><pkg:part pkg:name="/word/document.xml"><pkg:xmlData><w:document xmlns:w="${W}"><w:body>${paragraph}<w:p/></w:body></w:document></pkg:xmlData></pkg:part></pkg:package>`;
const run = (text: string, props = "") =>
  `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const p = (...content: string[]) => `<w:p>${content.join("")}</w:p>`;
const field = (code: string, result: string) =>
  `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>${code}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${run(result)}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;

const mark = (
  paragraph: string,
  text: string,
  start = 0,
  end = text.length,
  items = false,
) =>
  markWordParagraphOoxml(pkg(paragraph), text, start, end, 1, {
    items,
    formats: true,
  });

describe("format spans of a part", () => {
  it("marks each run whose emphasis the rest of the text does not share", () => {
    expect(
      mark(
        p(
          run("Plain "),
          run("bold", "<w:b/>"),
          run(" "),
          run("both", "<w:b/><w:i/>"),
          run(" and "),
          run("lined", '<w:u w:val="double"/>'),
          run(" "),
          run("off", '<w:strike w:val="0"/>'),
          run("."),
        ),
        "Plain bold both and lined off.",
      ),
    ).toEqual({
      text: "Plain ⟦1⟧bold⟦/1⟧ ⟦2⟧both⟦/2⟧ and ⟦3⟧lined⟦/3⟧ ⟦4⟧off⟦/4⟧.",
      markers: [],
      next: 5,
      formats: [
        { number: 1, emphasis: { bold: true } },
        { number: 2, emphasis: { bold: true, italic: true } },
        { number: 3, emphasis: { underline: "Double" } },
        { number: 4, emphasis: { strikeThrough: false } },
      ],
    });
  });

  it("joins neighbouring runs of the same emphasis and leaves out what every run shares", () => {
    expect(
      mark(
        p(
          run("All red ", '<w:i/><w:color w:val="C00000"/>'),
          run("bold", '<w:b/><w:i/><w:color w:val="C00000"/>'),
          run("er", '<w:b/><w:i/><w:lang w:val="de-DE"/>'),
          run(" end", "<w:i/>"),
        ),
        "All red bolder end",
      ),
    ).toMatchObject({
      text: "All red ⟦1⟧bolder⟦/1⟧ end",
      formats: [{ number: 1, emphasis: { bold: true } }],
    });
  });

  it("marks only the part's own text, from its own runs", () => {
    const paragraph = p(
      run("Bold ", "<w:b/>"),
      run("plain "),
      run("again", "<w:b/>"),
    );
    expect(mark(paragraph, "Bold plain again", 5, 10)).toEqual({
      text: "plain",
      markers: [],
      next: 1,
    });
    expect(mark(paragraph, "Bold plain again", 2, 13)).toMatchObject({
      text: "⟦1⟧ld ⟦/1⟧plain ⟦2⟧ag⟦/2⟧",
    });
  });

  it("never marks a tab that has no text run of its own", () => {
    expect(
      mark(
        p(
          run("Plain"),
          "<w:r><w:rPr><w:b/></w:rPr><w:tab/></w:r>",
          run("words"),
        ),
        "Plain\twords",
      ),
    ).toEqual({ text: "Plain\twords", markers: [], next: 1 });
  });

  it("keeps spans inside the pieces between kept items, after an item's start and before its end", () => {
    expect(
      mark(
        p(
          run("See "),
          run("this", "<w:b/>"),
          field(" PAGE ", "3"),
          run("now", "<w:i/>"),
          run(" too."),
        ),
        "See this3now too.",
        0,
        17,
        true,
      ),
    ).toMatchObject({
      text: "See ⟦1⟧this⟦/1⟧⟦2⟧⟦3⟧now⟦/3⟧ too.",
      markers: [expect.objectContaining({ number: 2, kind: "field" })],
      formats: [
        { number: 1, emphasis: { bold: true } },
        { number: 3, emphasis: { italic: true } },
      ],
    });
  });

  it(`marks none past ${WORD_FORMAT_SPANS_MAX} spans in one part`, () => {
    const words = (count: number) =>
      Array.from(
        { length: count },
        (_, k) => run(`w${k}`, "<w:b/>") + run(" "),
      );
    const at = Array.from(
      { length: WORD_FORMAT_SPANS_MAX },
      (_, k) => `w${k} `,
    ).join("");
    expect(mark(p(...words(WORD_FORMAT_SPANS_MAX)), at)?.formats).toHaveLength(
      WORD_FORMAT_SPANS_MAX,
    );
    const past = `${at}w${WORD_FORMAT_SPANS_MAX} `;
    expect(mark(p(...words(WORD_FORMAT_SPANS_MAX + 1)), past)).toEqual({
      text: past,
      markers: [],
      next: 1,
    });
  });
});

describe("format span words and fonts", () => {
  it("words a span's emphasis for kept_items", () => {
    expect(
      wordEmphasisWords({
        bold: false,
        italic: true,
        underline: "None",
        strikeThrough: true,
      }),
    ).toEqual(["not bold", "italic", "no underline", "strikethrough"]);
  });

  it("sets the complex-script twins only where they can be set", () => {
    const emphasis = { bold: true, italic: false, underline: "Single" };
    expect(wordEmphasisFont(emphasis, false)).toEqual(emphasis);
    expect(wordEmphasisFont(emphasis, true)).toEqual({
      ...emphasis,
      boldBidirectional: true,
      italicBidirectional: false,
    });
  });
});
