import { describe, expect, it } from "vitest";

import {
  markWordSelectionPart,
  readWordParagraphItems,
  splitWordMarkedLine,
} from "../wordSelectionItems";

const pkg = (paragraph: string) =>
  `<?xml version="1.0" standalone="yes"?><pkg:package xmlns:pkg="http://schemas.microsoft.com/office/2006/xmlPackage"><pkg:part pkg:name="/word/document.xml"><pkg:xmlData><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${paragraph}<w:p/></w:body></w:document></pkg:xmlData></pkg:part></pkg:package>`;
const run = (text: string) =>
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const p = (...content: string[]) => `<w:p>${content.join("")}</w:p>`;
const field = (code: string, result: string) =>
  `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>${code}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${run(result)}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
const comment = (text: string) =>
  `<w:commentRangeStart w:id="0"/>${run(text)}<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r>`;

const read = (paragraph: string, rangeText: string) => {
  const result = readWordParagraphItems(pkg(paragraph), rangeText);
  if (!("items" in result)) throw new Error(result.refused);
  return result;
};

describe("readWordParagraphItems", () => {
  it("finds no items in plain text", () => {
    expect(read(p(run("PL1 Plain "), run("text.")), "PL1 Plain text.")).toEqual(
      {
        items: [],
        references: [],
      },
    );
  });

  it("places a complex field on its result, with its code as detail", () => {
    const { items } = read(
      p(run("FD1 before "), field(" DATE ", "2026-10-10"), run(" after.")),
      "FD1 before 2026-10-10 after.",
    );
    expect(items).toEqual([
      expect.objectContaining({
        kind: "field",
        start: 11,
        end: 21,
        shows: "2026-10-10",
        detail: " DATE ",
      }),
    ]);
  });

  it("places a simple field, a note reference, a picture and a line break", () => {
    const { items } = read(
      p(
        run("A "),
        `<w:fldSimple w:instr=" PAGE ">${run("3")}</w:fldSimple>`,
        `<w:r><w:footnoteReference w:id="1"/></w:r>`,
        run(" B"),
        `<w:r><w:drawing/></w:r>`,
        `<w:r><w:br/></w:r>`,
        run("C"),
      ),
      "A 3\u0002 B\u000BC",
    );
    expect(
      items.map(({ kind, start, end, shows }) => ({ kind, start, end, shows })),
    ).toEqual([
      { kind: "field", start: 2, end: 3, shows: "3" },
      { kind: "note", start: 3, end: 4, shows: "\u0002" },
      { kind: "picture", start: 6, end: 6, shows: "" },
      { kind: "break", start: 6, end: 7, shows: "\u000B" },
    ]);
  });

  it("spans a link and a content control over their text", () => {
    const { items } = read(
      p(
        run("Go "),
        `<w:hyperlink r:id="rId7">${run("here")}</w:hyperlink>`,
        `<w:sdt><w:sdtPr/><w:sdtContent>${run(" now")}</w:sdtContent></w:sdt>`,
      ),
      "Go here now",
    );
    expect(
      items.map(({ kind, start, end, detail }) => ({
        kind,
        start,
        end,
        detail,
      })),
    ).toEqual([
      { kind: "link", start: 3, end: 7, detail: "rId7" },
      { kind: "control", start: 7, end: 11, detail: "" },
    ]);
  });

  it("reads a comment range with its anchor shown on the web and not on desktop", () => {
    const paragraph = p(run("CM1 "), comment("anchor"), run(" after."));
    expect(read(paragraph, "CM1 anchor after.")).toEqual({
      items: [expect.objectContaining({ kind: "comment", start: 4, end: 10 })],
      references: [10],
    });
    expect(read(paragraph, "CM1 anchor\u0005 after.").references).toEqual([10]);
  });

  it("opens a comment range that started in an earlier paragraph at the start", () => {
    const { items } = read(
      p(run("tail"), `<w:commentRangeEnd w:id="4"/>`, run(" rest")),
      "tail rest",
    );
    expect(items).toEqual([
      expect.objectContaining({
        kind: "comment",
        start: 0,
        end: 4,
        openEnded: "start",
      }),
    ]);
  });

  it.each([
    ["a tracked insertion", p(`<w:ins w:id="1">${run("new")}</w:ins>`), "new"],
    ["a symbol", p(`<w:r><w:sym w:font="Wingdings" w:char="F0E0"/></w:r>`), ""],
    ["a page break", p(run("a"), `<w:r><w:br w:type="page"/></w:r>`), "a"],
    [
      "a locked content control",
      p(
        `<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>${run("x")}</w:sdtContent></w:sdt>`,
      ),
      "x",
    ],
    [
      "a bookmark",
      p(
        `<w:bookmarkStart w:id="1" w:name="_Toc1"/>`,
        run("x"),
        `<w:bookmarkEnd w:id="1"/>`,
      ),
      "x",
    ],
  ])("refuses %s", (_, paragraph, rangeText) => {
    expect(readWordParagraphItems(pkg(paragraph), rangeText)).toEqual({
      refused: "unsupported",
    });
  });

  it("lets Word's own last-edit bookmark pass", () => {
    expect(
      read(
        p(
          `<w:bookmarkStart w:id="0" w:name="_GoBack"/>`,
          run("x"),
          `<w:bookmarkEnd w:id="0"/>`,
        ),
        "x",
      ).items,
    ).toEqual([]);
  });

  it("refuses runs that do not spell paragraph.text", () => {
    expect(readWordParagraphItems(pkg(p(run("abc"))), "abd")).toEqual({
      refused: "misaligned",
    });
    expect(readWordParagraphItems(pkg(p(run("abc"))), "abcd")).toEqual({
      refused: "misaligned",
    });
  });
});

describe("markWordSelectionPart", () => {
  const fieldText = "FD1 before 2026-10-10 after.";
  const fieldItems = () =>
    read(
      p(run("FD1 before "), field(" DATE ", "2026-10-10"), run(" after.")),
      fieldText,
    );

  it("puts a marker where a field shows its result", () => {
    expect(
      markWordSelectionPart(fieldText, fieldItems(), 4, fieldText.length),
    ).toEqual({
      text: "before ⟦1⟧ after.",
      markers: [
        {
          number: 1,
          kind: "field",
          end: "point",
          shows: "2026-10-10",
          detail: " DATE ",
        },
      ],
      next: 2,
    });
  });

  it("refuses a part that cuts through a field's result", () => {
    expect(markWordSelectionPart(fieldText, fieldItems(), 4, 15)).toBeNull();
  });

  it("numbers on from where the previous paragraph stopped", () => {
    expect(
      markWordSelectionPart(fieldText, fieldItems(), 0, fieldText.length, 5)
        ?.text,
    ).toBe("FD1 before ⟦5⟧ after.");
  });

  const linkText = "Alpha foxtrot link golf";
  const linkItems = () =>
    read(
      p(
        run("Alpha "),
        `<w:hyperlink r:id="rId3">${run("foxtrot link")}</w:hyperlink>`,
        run(" golf"),
      ),
      linkText,
    );

  it("marks both ends of a link inside the part", () => {
    expect(
      markWordSelectionPart(linkText, linkItems(), 0, linkText.length)?.text,
    ).toBe("Alpha ⟦1⟧foxtrot link⟦/1⟧ golf");
  });

  it("marks nothing when the part is exactly the link's text, so the rewrite stays inside it", () => {
    expect(markWordSelectionPart(linkText, linkItems(), 6, 18)).toEqual({
      text: "foxtrot link",
      markers: [],
      next: 1,
    });
  });

  it("marks only the end of a link the part starts in", () => {
    expect(
      markWordSelectionPart(linkText, linkItems(), 6, linkText.length)?.text,
    ).toBe("foxtrot link⟦/1⟧ golf");
  });

  it("hides a comment's anchor behind its range's end, on the web too", () => {
    const desktop = "CM1 anchor after.";
    const web = "CM1 anchor\u0005 after.";
    const paragraph = p(run("CM1 "), comment("anchor"), run(" after."));
    expect(
      markWordSelectionPart(
        desktop,
        read(paragraph, desktop),
        0,
        desktop.length,
      )?.text,
    ).toBe("CM1 ⟦1⟧anchor⟦/1⟧ after.");
    expect(
      markWordSelectionPart(web, read(paragraph, web), 0, web.length)?.text,
    ).toBe("CM1 ⟦1⟧anchor⟦/1⟧ after.");
  });

  it("refuses a part holding a comment's anchor but not its range's end", () => {
    const web = "CM1 anchor\u0005 after.";
    const items = read(p(run("CM1 "), comment("anchor"), run(" after.")), web);
    expect(markWordSelectionPart(web, items, 10, web.length)).toBeNull();
  });

  it("refuses a part that already holds a marker bracket", () => {
    const text = "a ⟦1⟧ b";
    expect(
      markWordSelectionPart(text, read(p(run(text)), text), 0, text.length),
    ).toBeNull();
  });
});

describe("splitWordMarkedLine", () => {
  const markers = [
    { number: 1, end: "open" as const },
    { number: 1, end: "close" as const },
    { number: 2, end: "point" as const },
  ];

  it("splits a rewrite at its markers, which may move within the text", () => {
    expect(splitWordMarkedLine("⟦1⟧Hier⟦/1⟧ und ⟦2⟧.", markers)).toEqual({
      pieces: ["", "Hier", " und ", "."],
    });
  });

  it.each([
    ["a lost marker", "⟦1⟧Hier⟦/1⟧ und."],
    ["a doubled marker", "⟦1⟧Hier⟦/1⟧ ⟦2⟧ ⟦2⟧"],
    ["swapped markers", "⟦2⟧ ⟦1⟧Hier⟦/1⟧"],
    ["a span end turned into a start", "⟦1⟧Hier⟦1⟧ ⟦2⟧"],
    ["a stray bracket", "⟦1⟧Hier⟦/1⟧ ⟦2⟧ ⟦"],
  ])("refuses %s", (_, line) => {
    expect(splitWordMarkedLine(line, markers)).toEqual({
      refused: "MARKERS_CHANGED",
    });
  });
});
