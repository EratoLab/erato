import { describe, expect, it } from "vitest";

import {
  markWordSelectionPart,
  readWordParagraphItems,
  splitWordMarkedLine,
} from "../wordSelectionItems";

import type { WordKeptItem } from "../wordSelectionItems";

const pkg = (paragraph: string) =>
  `<?xml version="1.0" standalone="yes"?><pkg:package xmlns:pkg="http://schemas.microsoft.com/office/2006/xmlPackage"><pkg:part pkg:name="/word/document.xml"><pkg:xmlData><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${paragraph}<w:p/></w:body></w:document></pkg:xmlData></pkg:part></pkg:package>`;
const run = (text: string) =>
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const p = (...content: string[]) => `<w:p>${content.join("")}</w:p>`;
const field = (code: string, result: string) =>
  `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>${code}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${run(result)}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
const comment = (text: string) =>
  `<w:commentRangeStart w:id="0"/>${run(text)}<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r>`;

const opens = (id: number, name: string) =>
  `<w:bookmarkStart w:id="${id}" w:name="${name}"/>`;
const closes = (id: number) => `<w:bookmarkEnd w:id="${id}"/>`;
const bookmarks = (items: readonly WordKeptItem[]) =>
  items.map(({ kind, start, end, detail, openEnded }) => ({
    kind,
    start,
    end,
    detail,
    ...(openEnded ? { openEnded } : {}),
  }));

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
      "a bookmark inside a field's result",
      p(
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>`,
        opens(1, "_Ref1"),
        run("3"),
        closes(1),
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>`,
      ),
      "3",
    ],
    [
      "a bookmark ending inside a field's code",
      p(
        opens(1, "_Ref1"),
        run("See "),
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>`,
        closes(1),
        `<w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${run("3")}<w:r><w:fldChar w:fldCharType="end"/></w:r>`,
      ),
      "See 3",
    ],
    [
      "a bookmark inside a simple field",
      p(
        `<w:fldSimple w:instr=" PAGE ">${opens(1, "_Ref1")}${run("3")}${closes(1)}</w:fldSimple>`,
      ),
      "3",
    ],
    [
      "a table column's bookmark",
      p(
        `<w:bookmarkStart w:id="1" w:name="Column" w:colFirst="0" w:colLast="1"/>`,
        run("x"),
        closes(1),
      ),
      "x",
    ],
  ])("refuses %s", (_, paragraph, rangeText) => {
    expect(readWordParagraphItems(pkg(paragraph), rangeText)).toEqual({
      refused: "unsupported",
    });
  });

  it.each([
    ["a table of contents'", "_Toc938001"],
    ["a cross-reference's", "_Ref938002"],
    ["a pasted link's", "_Hlk938003"],
    ["a user's", "Intro938"],
  ])("reads %s bookmark as an item with its name", (_, name) => {
    const { items } = read(
      p(
        run("PL1 Plain "),
        opens(4, name),
        run("lima mike"),
        closes(4),
        run("."),
      ),
      "PL1 Plain lima mike.",
    );
    expect(bookmarks(items)).toEqual([
      { kind: "bookmark", start: 10, end: 19, detail: name },
    ]);
  });

  it("reads stacked and nested bookmarks in the order they start", () => {
    const { items } = read(
      p(
        opens(0, "_Toc1"),
        opens(1, "_Ref2"),
        run("H2 Scope and "),
        opens(2, "Inner"),
        run("aims"),
        closes(2),
        closes(1),
        closes(0),
      ),
      "H2 Scope and aims",
    );
    expect(bookmarks(items)).toEqual([
      { kind: "bookmark", start: 0, end: 17, detail: "_Toc1" },
      { kind: "bookmark", start: 0, end: 17, detail: "_Ref2" },
      { kind: "bookmark", start: 13, end: 17, detail: "Inner" },
    ]);
  });

  it("reads a bookmark that starts or ends in another paragraph as open-ended", () => {
    expect(
      bookmarks(
        read(p(run("Chapter "), opens(3, "Long"), run("one")), "Chapter one")
          .items,
      ),
    ).toEqual([
      { kind: "bookmark", start: 8, end: 11, detail: "Long", openEnded: "end" },
    ]);
    expect(
      bookmarks(
        read(p(run("still"), closes(3), run(" after")), "still after").items,
      ),
    ).toEqual([
      { kind: "bookmark", start: 0, end: 5, detail: "", openEnded: "start" },
    ]);
  });

  it("reads an empty bookmark as a span without text", () => {
    expect(
      bookmarks(
        read(
          p(run("Here"), opens(5, "Spot"), closes(5), run(" now")),
          "Here now",
        ).items,
      ),
    ).toEqual([{ kind: "bookmark", start: 4, end: 4, detail: "Spot" }]);
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

  it("never marks a bookmark", () => {
    const text = "H1 Selection probe heading";
    const items = read(p(opens(0, "_Toc1"), run(text), closes(0)), text);
    expect(markWordSelectionPart(text, items, 0, text.length, 3)).toEqual({
      text,
      markers: [],
      next: 3,
    });
    expect(markWordSelectionPart(text, items, 13, 18)).toEqual({
      text: "probe",
      markers: [],
      next: 1,
    });
  });

  it("refuses a part a bookmark starts or ends strictly inside", () => {
    const text = "PL1 Plain lima mike papa.";
    const items = read(
      p(
        run("PL1 Plain "),
        opens(0, "Intro"),
        run("lima mike"),
        closes(0),
        run(" papa."),
      ),
      text,
    );
    expect(markWordSelectionPart(text, items, 0, text.length)).toBeNull();
    expect(markWordSelectionPart(text, items, 4, 15)).toBeNull();
    expect(markWordSelectionPart(text, items, 15, text.length)).toBeNull();
    expect(markWordSelectionPart(text, items, 10, 19)?.text).toBe("lima mike");
    expect(markWordSelectionPart(text, items, 4, 9)?.text).toBe("Plain");
  });

  it("accepts a bookmark end right beside an item the part marks", () => {
    const text = "Figure 1: Sales.";
    const items = read(
      p(
        opens(0, "_Ref1"),
        run("Figure "),
        field(" SEQ Figure ", "1"),
        closes(0),
        run(": Sales."),
      ),
      text,
    );
    expect(markWordSelectionPart(text, items, 0, text.length)).toMatchObject({
      text: "Figure ⟦1⟧: Sales.",
      markers: [{ number: 1, kind: "field", end: "point" }],
    });
    const before = read(
      p(
        run("See "),
        opens(0, "_Ref1"),
        field(" REF x ", "7"),
        closes(0),
        run("."),
      ),
      "See 7.",
    );
    expect(markWordSelectionPart("See 7.", before, 0, 6)?.text).toBe(
      "See ⟦1⟧.",
    );
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
