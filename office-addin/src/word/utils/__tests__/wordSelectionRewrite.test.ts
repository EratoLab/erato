import { describe, expect, it } from "vitest";

import { readWordParagraphItems } from "../wordSelectionItems";
import {
  rewriteWordParagraphPart,
  wordPartFormatLoss,
} from "../wordSelectionRewrite";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const pkg = (paragraph: string) =>
  `<?xml version="1.0" standalone="yes"?><pkg:package xmlns:pkg="http://schemas.microsoft.com/office/2006/xmlPackage"><pkg:part pkg:name="/word/document.xml"><pkg:xmlData><w:document xmlns:w="${W}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${paragraph}<w:p/></w:body></w:document></pkg:xmlData></pkg:part></pkg:package>`;
const run = (text: string, props = "") =>
  `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const p = (...content: string[]) => `<w:p>${content.join("")}</w:p>`;
const field = (code: string, result: string) =>
  `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>${code}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${run(result)}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;

/** The rewritten paragraph's own XML, for asserting on its structure. */
function paragraphOf(ooxml: string): Element {
  const doc = new DOMParser().parseFromString(ooxml, "application/xml");
  return doc.getElementsByTagNameNS(W, "p")[0];
}
const names = (element: Element) =>
  Array.from(element.children).map((c) =>
    c.localName === "r"
      ? Array.from(c.children)
          .filter((x) => x.localName !== "rPr")
          .map((x) =>
            x.localName === "t" ? `"${x.textContent}"` : x.localName,
          )
          .join("+")
      : c.localName,
  );

function rewrite(
  paragraph: string,
  rangeText: string,
  start: number,
  end: number,
  pieces: string[],
) {
  const result = rewriteWordParagraphPart(
    pkg(paragraph),
    rangeText,
    start,
    end,
    pieces,
  );
  if (!result) throw new Error("refused");
  return result;
}

describe("rewriteWordParagraphPart", () => {
  const fd = p(
    run("FD1 before "),
    field(" DATE ", "2026-10-10"),
    run(" after."),
  );
  const fdText = "FD1 before 2026-10-10 after.";

  it("rewrites the text around a field and keeps the field whole", () => {
    const result = rewrite(fd, fdText, 4, fdText.length, ["vor ", " nach."]);
    expect(result.rangeText).toBe("FD1 vor 2026-10-10 nach.");
    expect(names(paragraphOf(result.ooxml))).toEqual([
      '"FD1 vor "',
      "fldChar",
      "instrText",
      "fldChar",
      '"2026-10-10"',
      "fldChar",
      '" nach."',
    ]);
    expect(readWordParagraphItems(result.ooxml, result.rangeText)).toEqual({
      items: [
        expect.objectContaining({
          kind: "field",
          shows: "2026-10-10",
          detail: " DATE ",
        }),
      ],
      references: [],
    });
  });

  it("places new text before a field where there was none", () => {
    const result = rewrite(fd, fdText, 11, fdText.length, ["前 ", " after."]);
    expect(result.rangeText).toBe("FD1 before 前 2026-10-10 after.");
    expect(names(paragraphOf(result.ooxml)).slice(0, 2)).toEqual([
      '"FD1 before 前 "',
      "fldChar",
    ]);
  });

  it("gives a rewrite only the formatting its old text shared, not its first word's", () => {
    const result = rewrite(
      p(
        run("Bold", "<w:b/><w:i/>"),
        run(" rest", "<w:i/>"),
        field(" PAGE ", "3"),
      ),
      "Bold rest3",
      0,
      10,
      ["Fett und Rest", ""],
    );
    const first = paragraphOf(result.ooxml).getElementsByTagNameNS(W, "r")[0];
    expect(first.textContent).toBe("Fett und Rest");
    expect(first.getElementsByTagNameNS(W, "b")).toHaveLength(0);
    expect(first.getElementsByTagNameNS(W, "i")).toHaveLength(1);
  });

  const mx = p(
    run("Alpha "),
    `<w:hyperlink r:id="rId3">${run("foxtrot link", '<w:rStyle w:val="Hyperlink"/>')}</w:hyperlink>`,
    run(" golf"),
  );
  const mxText = "Alpha foxtrot link golf";

  it("rewrites a link's text inside the link, keeping its target", () => {
    const result = rewrite(mx, mxText, 0, mxText.length, [
      "Alpha ",
      "Foxtrott-Link",
      " Golf",
    ]);
    expect(result.rangeText).toBe("Alpha Foxtrott-Link Golf");
    const link = paragraphOf(result.ooxml).getElementsByTagNameNS(
      W,
      "hyperlink",
    )[0];
    expect(link.getAttribute("r:id")).toBe("rId3");
    expect(link.textContent).toBe("Foxtrott-Link");
  });

  it("keeps a rewrite of exactly a link's text inside the link", () => {
    const result = rewrite(mx, mxText, 6, 18, ["neuer Link"]);
    const link = paragraphOf(result.ooxml).getElementsByTagNameNS(
      W,
      "hyperlink",
    )[0];
    expect(link.textContent).toBe("neuer Link");
    expect(result.rangeText).toBe("Alpha neuer Link golf");
  });

  const cm = p(
    run("CM1 "),
    `<w:commentRangeStart w:id="0"/>`,
    run("anchor phrase"),
    `<w:commentRangeEnd w:id="0"/>`,
    `<w:r><w:commentReference w:id="0"/></w:r>`,
    run(" after."),
  );

  it.each([
    ["desktop", "CM1 anchor phrase after.", "CM1 Ankerwendung danach."],
    [
      "the web",
      "CM1 anchor phrase\u0005 after.",
      "CM1 Ankerwendung\u0005 danach.",
    ],
  ])(
    "anchors a comment to exactly its rewritten text on %s",
    (_, text, expected) => {
      const result = rewrite(cm, text, 0, text.length, [
        "CM1 ",
        "Ankerwendung",
        " danach.",
      ]);
      expect(result.rangeText).toBe(expected);
      expect(names(paragraphOf(result.ooxml))).toEqual([
        '"CM1 "',
        "commentRangeStart",
        '"Ankerwendung"',
        "commentRangeEnd",
        "commentReference",
        '" danach."',
      ]);
    },
  );

  it("gives text after a footnote reference the text's formatting, not the reference's", () => {
    const fn = p(
      run("Host"),
      `<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="1"/></w:r>`,
    );
    const result = rewrite(fn, "Host\u0002", 0, 5, ["Gast", " hier"]);
    expect(result.rangeText).toBe("Gast\u0002 hier");
    const runs = Array.from(
      paragraphOf(result.ooxml).getElementsByTagNameNS(W, "r"),
    );
    expect(runs.at(-1)!.getElementsByTagNameNS(W, "vertAlign")).toHaveLength(0);
  });

  it("writes a tab as w:tab and keeps formatting outside the part", () => {
    const result = rewrite(
      p(run("Bold ", "<w:b/>"), run("plain text")),
      "Bold plain text",
      5,
      15,
      ["a\tb"],
    );
    expect(result.rangeText).toBe("Bold a\tb");
    expect(names(paragraphOf(result.ooxml))).toEqual([
      '"Bold "',
      '"a"+tab+"b"',
    ]);
    expect(
      paragraphOf(result.ooxml).getElementsByTagNameNS(W, "b"),
    ).toHaveLength(1);
  });

  it("splits a line break out of its text run and keeps it", () => {
    const result = rewrite(
      p(`<w:r><w:t>one</w:t><w:br/><w:t>two</w:t></w:r>`),
      "one\u000Btwo",
      0,
      7,
      ["eins", "zwei"],
    );
    expect(result.rangeText).toBe("eins\u000Bzwei");
    expect(names(paragraphOf(result.ooxml))).toEqual([
      '"eins"',
      "br",
      '"zwei"',
    ]);
  });

  it("refuses pieces that do not match the part's markers", () => {
    expect(
      rewriteWordParagraphPart(pkg(fd), fdText, 4, fdText.length, ["only one"]),
    ).toBeNull();
  });

  it("refuses a paragraph that no longer spells the captured text", () => {
    expect(
      rewriteWordParagraphPart(pkg(fd), "FD1 changed", 0, 11, ["x"]),
    ).toBeNull();
  });
});

describe("rewriteWordParagraphPart with bookmarks", () => {
  const opens = (id: number, name: string) =>
    `<w:bookmarkStart w:id="${id}" w:name="${name}"/>`;
  const closes = (id: number) => `<w:bookmarkEnd w:id="${id}"/>`;
  /** What each bookmark of the result covers. */
  const covers = (result: { ooxml: string; rangeText: string }) => {
    const read = readWordParagraphItems(result.ooxml, result.rangeText);
    if (!("items" in read)) throw new Error(read.refused);
    return read.items
      .filter((item) => item.kind === "bookmark")
      .map((item) => [
        item.detail,
        result.rangeText.slice(item.start, item.end),
      ]);
  };
  const heading = "H1 Selection probe heading";

  it("keeps a heading's bookmark around its whole rewritten text", () => {
    const result = rewrite(
      p(opens(0, "_Toc1"), run(heading), closes(0)),
      heading,
      0,
      heading.length,
      ["H1 A shorter heading"],
    );
    expect(names(paragraphOf(result.ooxml))).toEqual([
      "bookmarkStart",
      '"H1 A shorter heading"',
      "bookmarkEnd",
    ]);
    expect(covers(result)).toEqual([["_Toc1", "H1 A shorter heading"]]);
  });

  it("keeps a heading's bookmark around it when a word inside is rewritten", () => {
    const result = rewrite(
      p(opens(0, "_Toc1"), run(heading), closes(0)),
      heading,
      13,
      18,
      ["test"],
    );
    expect(covers(result)).toEqual([["_Toc1", "H1 Selection test heading"]]);
  });

  it("keeps stacked table of contents and cross-reference bookmarks around the new text", () => {
    const result = rewrite(
      p(
        opens(0, "_Toc1"),
        opens(1, "_Ref2"),
        run("H2 Scope"),
        closes(1),
        closes(0),
      ),
      "H2 Scope",
      0,
      8,
      ["H2 Purpose"],
    );
    expect(covers(result)).toEqual([
      ["_Toc1", "H2 Purpose"],
      ["_Ref2", "H2 Purpose"],
    ]);
  });

  it("leaves a bookmark outside the part over its own words", () => {
    const text = "PL1 Plain lima mike papa.";
    const result = rewrite(
      p(
        run("PL1 Plain "),
        opens(0, "Intro"),
        run("lima mike"),
        closes(0),
        run(" papa."),
      ),
      text,
      4,
      9,
      ["Short"],
    );
    expect(result.rangeText).toBe("PL1 Short lima mike papa.");
    expect(covers(result)).toEqual([["Intro", "lima mike"]]);
  });

  it("keeps a caption's bookmark around its new label and its SEQ field", () => {
    const result = rewrite(
      p(
        opens(0, "_Ref1"),
        run("Figure "),
        field(" SEQ Figure ", "1"),
        closes(0),
        run(": Sales."),
      ),
      "Figure 1: Sales.",
      0,
      16,
      ["Abbildung ", ": Umsatz."],
    );
    expect(covers(result)).toEqual([["_Ref1", "Abbildung 1"]]);
  });

  it("refuses a bookmark that runs into the next paragraph, or came from the previous one", () => {
    expect(
      rewriteWordParagraphPart(
        pkg(p(opens(3, "Long"), run("Chapter one"))),
        "Chapter one",
        0,
        11,
        ["Kapitel eins"],
      ),
    ).toBeNull();
    expect(
      rewriteWordParagraphPart(pkg(p(run("still"), closes(3))), "still", 0, 5, [
        "noch immer",
      ]),
    ).toBeNull();
    expect(
      rewriteWordParagraphPart(
        pkg(p(closes(3), run("Next paragraph."))),
        "Next paragraph.",
        5,
        14,
        ["section"],
      ),
    ).toBeNull();
  });

  it("refuses a paragraph with a bookmark's marks around it, between paragraphs", () => {
    const page = p(run("Page "), field(" PAGE ", "3"), run(" of the report."));
    const text = "Page 3 of the report.";
    expect(rewrite(page, text, 7, 21, ["of the summary."]).rangeText).toBe(
      "Page 3 of the summary.",
    );
    expect(
      rewriteWordParagraphPart(
        pkg(opens(3, "Whole") + page + closes(3)),
        text,
        7,
        21,
        ["of the summary."],
      ),
    ).toBeNull();
  });

  it("puts new text before an item outside the bookmark around just that item", () => {
    const result = rewrite(
      p(opens(0, "_Ref1"), field(" SEQ Table ", "4"), closes(0), run(" rest")),
      "4 rest",
      0,
      6,
      ["Table ", " rest"],
    );
    expect(names(paragraphOf(result.ooxml)).slice(0, 2)).toEqual([
      '"Table "',
      "bookmarkStart",
    ]);
    expect(covers(result)).toEqual([["_Ref1", "4"]]);
  });

  it("puts new text before an item inside only the bookmark around the whole part", () => {
    const result = rewrite(
      p(
        opens(0, "_Toc1"),
        opens(1, "_Ref1"),
        field(" SEQ Table ", "4"),
        closes(1),
        run(" rest"),
        closes(0),
      ),
      "4 rest",
      0,
      6,
      ["Table ", " rest"],
    );
    expect(covers(result)).toEqual([
      ["_Toc1", "Table 4 rest"],
      ["_Ref1", "4"],
    ]);
  });

  it("puts new text after an item outside the bookmark around just that item", () => {
    const result = rewrite(
      p(
        run("Total "),
        opens(0, "_Ref1"),
        field(" =SUM(ABOVE) ", "9"),
        closes(0),
      ),
      "Total 9",
      0,
      7,
      ["Sum ", " today"],
    );
    expect(covers(result)).toEqual([["_Ref1", "9"]]);
  });

  it("refuses new text where the bookmarks' order leaves it no place", () => {
    expect(
      rewriteWordParagraphPart(
        pkg(
          p(
            opens(1, "_Ref1"),
            opens(0, "_Toc1"),
            field(" SEQ Table ", "4"),
            closes(1),
            run(" rest"),
            closes(0),
          ),
        ),
        "4 rest",
        0,
        6,
        ["Table ", " rest"],
      ),
    ).toBeNull();
  });

  it("refuses a part a bookmark ends inside", () => {
    const text = "PL1 Plain lima mike papa.";
    expect(
      rewriteWordParagraphPart(
        pkg(
          p(
            run("PL1 Plain "),
            opens(0, "Intro"),
            run("lima mike"),
            closes(0),
            run(" papa."),
          ),
        ),
        text,
        0,
        text.length,
        ["PL1 Short."],
      ),
    ).toBeNull();
  });
});

describe("wordPartFormatLoss", () => {
  const NONE = { emphasis: false, script: false, other: false };
  const loss = (paragraph: string, text: string, start = 0, end?: number) =>
    wordPartFormatLoss(pkg(paragraph), text, start, end ?? text.length);
  const pageField = field(" PAGE ", "3");

  it("finds nothing to lose in text formatted alike, uniform colour and character style included", () => {
    expect(
      loss(
        p(
          run(
            "All red ",
            '<w:rStyle w:val="Strong"/><w:color w:val="C00000"/>',
          ),
          pageField,
          run(" words", '<w:rStyle w:val="Strong"/><w:color w:val="C00000"/>'),
        ),
        "All red 3 words",
      ),
    ).toEqual(NONE);
  });

  it.each([
    ["colour", '<w:color w:val="C00000"/>'],
    ["highlight", '<w:highlight w:val="yellow"/>'],
    ["font", '<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/>'],
    ["size", '<w:sz w:val="28"/>'],
    ["character style", '<w:rStyle w:val="Strong"/>'],
  ])("loses a %s on part of the text", (_, props) => {
    expect(
      loss(
        p(run("Part "), run("marked", props), run(" text"), pageField),
        "Part marked text3",
      ),
    ).toEqual({ ...NONE, other: true });
  });

  it("tells superscript and emphasis on part of the text apart from the rest", () => {
    expect(
      loss(
        p(
          run("Area m"),
          run("2", '<w:vertAlign w:val="superscript"/>'),
          pageField,
        ),
        "Area m23",
      ),
    ).toEqual({ ...NONE, script: true });
    expect(
      loss(
        p(run("Plain "), run("bold", "<w:b/>"), run(" words"), pageField),
        "Plain bold words3",
      ),
    ).toEqual({ ...NONE, emphasis: true });
  });

  it("judges only the selected part of the paragraph", () => {
    const text = "Plain words red3";
    const paragraph = p(
      run("Plain words "),
      run("red", '<w:color w:val="C00000"/>'),
      pageField,
    );
    expect(loss(paragraph, text, 0, 11)).toEqual(NONE);
    expect(loss(paragraph, text)).toEqual({ ...NONE, other: true });
  });

  it("keeps pieces formatted differently from each other, each written with its own runs", () => {
    expect(
      loss(
        p(
          run("Red words ", '<w:color w:val="C00000"/>'),
          pageField,
          run(" blue words", '<w:color w:val="0000FF"/>'),
        ),
        "Red words 3 blue words",
      ),
    ).toEqual(NONE);
  });

  it("does not count a link's Hyperlink style, a field's result or a note reference against the text", () => {
    expect(
      loss(
        p(
          run("Alpha "),
          `<w:hyperlink r:id="rId3">${run("link", '<w:rStyle w:val="Hyperlink"/>')}</w:hyperlink>`,
          run(" golf "),
          `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> DATE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${run("2026", '<w:b/><w:color w:val="C00000"/>')}<w:r><w:fldChar w:fldCharType="end"/></w:r>`,
          `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="1"/></w:r>`,
          run(" end."),
        ),
        "Alpha link golf 2026\u0002 end.",
      ),
    ).toEqual(NONE);
  });

  it("ignores what changes nothing a reader sees", () => {
    expect(
      loss(
        p(
          run("Spelled ", '<w:lang w:val="en-GB"/><w:noProof/>'),
          run("auto ", '<w:color w:val="auto"/><w:highlight w:val="none"/>'),
          run("hinted ", '<w:rFonts w:hint="eastAsia"/>'),
          run("level", '<w:vertAlign w:val="baseline"/>'),
          pageField,
        ),
        "Spelled auto hinted level3",
      ),
    ).toEqual(NONE);
  });

  it("is null for a part that cuts through a field", () => {
    expect(
      wordPartFormatLoss(
        pkg(p(run("Page "), field(" PAGE ", "12"), run(" of"))),
        "Page 12 of",
        0,
        6,
      ),
    ).toBeNull();
  });
});

describe("rewriteWordParagraphPart with format spans", () => {
  const props = (paragraph: Element) =>
    Array.from(paragraph.getElementsByTagNameNS(W, "r"))
      .filter((r) => r.getElementsByTagNameNS(W, "t").length)
      .map((r) => [
        r.getElementsByTagNameNS(W, "t")[0].textContent,
        Array.from(r.getElementsByTagNameNS(W, "rPr")[0]?.children ?? []).map(
          (c) => c.localName,
        ),
      ]);
  const text = "Red bold and italic 3 tail";
  const paragraph = p(
    run("Red ", '<w:color w:val="C00000"/>'),
    run(
      "bold",
      '<w:b/><w:bCs/><w:color w:val="C00000"/><w:lang w:val="en-GB"/>',
    ),
    run(" and ", '<w:color w:val="C00000"/>'),
    run("italic", '<w:i/><w:color w:val="C00000"/>'),
    run(" ", '<w:color w:val="C00000"/>'),
    field(" PAGE ", "3"),
    run(" tail", '<w:color w:val="C00000"/>'),
  );

  it("writes a span's text with its old run's toggles, twins included, in the schema's order", () => {
    const result = rewriteWordParagraphPart(pkg(paragraph), text, 0, 26, [
      [
        { text: "Rot ", span: null },
        { text: "fett", span: 0 },
        { text: " und ", span: null },
        { text: "kursiv", span: 1 },
        { text: " ", span: null },
      ],
      " Ende",
    ]);
    expect(result?.rangeText).toBe("Rot fett und kursiv 3 Ende");
    expect(props(paragraphOf(result!.ooxml))).toEqual([
      ["Rot ", ["color"]],
      ["fett", ["b", "bCs", "color"]],
      [" und ", ["color"]],
      ["kursiv", ["i", "color"]],
      [" ", ["color"]],
      ["3", []],
      [" Ende", ["color"]],
    ]);
  });

  it("gives a span moved across an item its toggles on both sides of it", () => {
    const result = rewriteWordParagraphPart(pkg(paragraph), text, 0, 26, [
      [
        { text: "Rot und ", span: null },
        { text: "fett ", span: 0 },
      ],
      [{ text: " fett", span: 0 }],
    ]);
    expect(result?.rangeText).toBe("Rot und fett 3 fett");
    expect(props(paragraphOf(result!.ooxml))).toEqual([
      ["Rot und ", ["color"]],
      ["fett ", ["b", "bCs", "color"]],
      ["3", []],
      [" fett", ["b", "bCs", "color"]],
    ]);
  });

  it("refuses a span the part does not have", () => {
    expect(
      rewriteWordParagraphPart(pkg(paragraph), text, 0, 26, [
        [{ text: "Rot", span: 2 }],
        " Ende",
      ]),
    ).toBeNull();
  });
});

describe("wordPartFormatLoss with format spans", () => {
  const NONE = { emphasis: false, script: false, other: false };
  const pageField = field(" PAGE ", "3");
  const loss = (paragraph: string, text: string) =>
    wordPartFormatLoss(pkg(paragraph), text, 0, text.length, true);

  it("loses no emphasis the spans carry", () => {
    expect(
      loss(
        p(
          run("Plain "),
          run("bold", "<w:b/><w:bCs/>"),
          run(" and "),
          run("struck", "<w:strike/>"),
          pageField,
        ),
        "Plain bold and struck3",
      ),
    ).toEqual(NONE);
  });

  it("still loses a twin no span carries, and anything else on part of the text", () => {
    expect(
      loss(
        p(run("Bold ", "<w:b/><w:bCs/>"), run("words", "<w:b/>"), pageField),
        "Bold words3",
      ),
    ).toEqual({ ...NONE, emphasis: true });
    expect(
      loss(
        p(
          run("Plain "),
          run("red", '<w:b/><w:color w:val="C00000"/>'),
          pageField,
        ),
        "Plain red3",
      ),
    ).toEqual({ ...NONE, other: true });
  });
});
