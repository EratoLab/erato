import { describe, expect, it } from "vitest";

import {
  packageXml,
  paragraph,
} from "../../../test/mocks/word/authoringFixtures";
import {
  alignWordLiveParagraphs,
  normalizeWordParagraphText,
  predictWordBodyParagraphs,
  wordParagraphAlignmentIssue,
} from "../wordLiveParagraphs";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const cell = (text: string) => `<w:tc>${paragraph(text)}</w:tc>`;
const table = (rows: string[][]) =>
  `<w:tbl><w:tblGrid/>${rows.map((row) => `<w:tr>${row.map(cell).join("")}</w:tr>`).join("")}</w:tbl>`;
const textBox = (text: string) =>
  `<w:p><w:r><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml"><v:textbox><w:txbxContent>${paragraph(text)}</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>`;

const live = (
  predicted: ReturnType<typeof predictWordBodyParagraphs>,
  edit: (
    p: { id: string; nesting: number; text?: string },
    i: number,
  ) => void = () => {},
) =>
  predicted.map((p, i) => {
    const entry = { id: `id-${i}`, nesting: p.nesting, text: p.text ?? "" };
    edit(entry, i);
    return entry;
  });

describe("body paragraph prediction", () => {
  it("lists table cells and block content controls in document order with their nesting", () => {
    const predicted = predictWordBodyParagraphs(
      packageXml(
        paragraph("Intro") +
          table([
            ["A", "B"],
            ["C", "D"],
          ]) +
          `<w:sdt><w:sdtPr><w:id w:val="7"/></w:sdtPr><w:sdtContent>${paragraph("Inside control")}${paragraph("Second")}</w:sdtContent></w:sdt>` +
          `<w:tbl><w:tr><w:tc>${paragraph("Outer")}${table([["Inner"]])}${paragraph("")}</w:tc></w:tr></w:tbl>` +
          paragraph("Outro"),
      ),
    );
    expect(predicted).toEqual([
      { ref: "b1", index: 0, nesting: 0, text: "Intro" },
      { ref: "b2", index: 0, nesting: 1, text: "A" },
      { ref: "b2", index: 1, nesting: 1, text: "B" },
      { ref: "b2", index: 2, nesting: 1, text: "C" },
      { ref: "b2", index: 3, nesting: 1, text: "D" },
      { ref: "b3", index: 0, nesting: 0, text: "Inside control" },
      { ref: "b3", index: 1, nesting: 0, text: "Second" },
      { ref: "b4", index: 0, nesting: 1, text: "Outer" },
      { ref: "b4", index: 1, nesting: 2, text: "Inner" },
      { ref: "b4", index: 2, nesting: 1, text: "" },
      { ref: "b5", index: 0, nesting: 0, text: "Outro" },
    ]);
  });

  it("leaves text-box paragraphs out and keeps duplicate and empty paragraphs", () => {
    const predicted = predictWordBodyParagraphs(
      packageXml(
        paragraph("Same") +
          textBox("Boxed") +
          paragraph("Same") +
          paragraph(""),
      ),
    );
    expect(predicted.map((p) => [p.ref, p.text])).toEqual([
      ["b1", "Same"],
      ["b2", undefined],
      ["b3", "Same"],
      ["b4", ""],
    ]);
    const withTextBox = live(predicted);
    withTextBox.splice(2, 0, { id: "boxed", nesting: 0, text: "Boxed" });
    expect(alignWordLiveParagraphs(predicted, withTextBox)).toBeNull();
  });

  it("only predicts text it can read exactly", () => {
    const predicted = predictWordBodyParagraphs(
      packageXml(
        `<w:p><w:r><w:t>Line</w:t><w:br/><w:t>break</w:t><w:tab/><w:t>tab</w:t></w:r></w:p>` +
          `<w:p><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p>` +
          `<w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>Hidden</w:t></w:r></w:p>` +
          `<w:p><w:r><w:br w:type="page"/></w:r></w:p>` +
          `<w:p><w:hyperlink><w:r><w:t>Link</w:t></w:r></w:hyperlink></w:p>`,
      ),
    );
    expect(predicted.map((p) => p.text)).toEqual([
      "Line\nbreak\ttab",
      undefined,
      undefined,
      undefined,
      "Link",
    ]);
  });
});

describe("live paragraph alignment", () => {
  const predicted = predictWordBodyParagraphs(
    packageXml(paragraph("One") + table([["Two"]]) + paragraph("Three")),
  );

  it("maps every block to its live paragraph IDs", () => {
    expect(alignWordLiveParagraphs(predicted, live(predicted))).toEqual(
      new Map([
        ["b1", ["id-0"]],
        ["b2", ["id-1"]],
        ["b3", ["id-2"]],
      ]),
    );
  });

  it("fails on a count shift, a nesting mismatch, a repeated ID or changed text", () => {
    expect(
      alignWordLiveParagraphs(predicted, [
        ...live(predicted),
        { id: "extra", nesting: 0, text: "" },
      ]),
    ).toBeNull();
    expect(
      wordParagraphAlignmentIssue(
        predicted,
        live(predicted, (p, i) => {
          if (i === 1) p.nesting = 0;
        }),
      ),
    ).toEqual({ issue: "nesting", index: 1 });
    expect(
      wordParagraphAlignmentIssue(
        predicted,
        live(predicted, (p) => {
          p.id = "same";
        }),
      ),
    ).toEqual({ issue: "id" });
    expect(
      wordParagraphAlignmentIssue(
        predicted,
        live(predicted, (p, i) => {
          if (i === 2) p.text = "Changed";
        }),
      ),
    ).toEqual({ issue: "text", index: 2 });
  });

  it("compares text only at the requested positions", () => {
    const changed = live(predicted, (p, i) => {
      if (i === 2) p.text = "Changed";
    });
    expect(alignWordLiveParagraphs(predicted, changed, [0, 1])).not.toBeNull();
    expect(alignWordLiveParagraphs(predicted, changed, [2])).toBeNull();
  });

  it("treats Word's \\v and \\r breaks as captured newlines", () => {
    const [p] = predictWordBodyParagraphs(
      packageXml(
        `<w:p><w:r><w:t>a</w:t><w:br/><w:t>b</w:t><w:cr/><w:t>c</w:t></w:r></w:p>`,
      ),
    );
    expect(normalizeWordParagraphText("a\vb\rc")).toBe("a\nb\nc");
    expect(
      alignWordLiveParagraphs([p], [{ id: "x", nesting: 0, text: "a\vb\rc" }]),
    ).not.toBeNull();
    expect(
      alignWordLiveParagraphs([p], [{ id: "x", nesting: 0, text: "a b c" }]),
    ).toBeNull();
  });

  it("refuses a package without a body", () => {
    expect(() =>
      predictWordBodyParagraphs(`<w:document xmlns:w="${W}"/>`),
    ).toThrow();
  });
});
