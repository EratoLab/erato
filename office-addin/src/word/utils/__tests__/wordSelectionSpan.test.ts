import { afterEach, describe, expect, it } from "vitest";

import {
  installWordSelectionHost,
  SV2_MAIN_DOCUMENT,
  uninstallWordSelectionHost,
} from "../../../test/mocks/word/selectionHost";
import {
  scanWordSelectionSpan,
  wordCellParagraphOoxml,
  wordSelectionStyleToggles,
} from "../wordSelectionSpan";

import type {
  MockSelectionDocument,
  MockSelectionTarget,
} from "../../../test/mocks/word/selectionHost";

const HOSTS = ["mac", "pc", "web"] as const;

afterEach(uninstallWordSelectionHost);

const DOC: MockSelectionDocument = {
  body: [
    "PL Plain words here.",
    { runs: [{ text: "AB All bold words.", font: { bold: true } }] },
    { runs: ["MB ", { text: "Mixed", font: { bold: true } }, " bold words."] },
    {
      runs: [
        { text: "CL Colored words.", font: { color: "#C00000", size: 14 } },
      ],
    },
    {
      runs: ["CP ", { text: "Part", font: { color: "#C00000" } }, " colored."],
    },
    {
      runs: [
        { text: "HL Highlighted words.", font: { highlightColor: "Yellow" } },
      ],
    },
    {
      runs: [
        "CS ",
        { text: "cs size", font: { sizeBidirectional: 20 } },
        " only.",
      ],
    },
    {
      runs: [
        {
          text: "TW Twin bold.",
          font: { bold: true, boldBidirectional: true },
        },
      ],
    },
    { runs: ["RS ", { text: "styled", rStyle: "Strong" }, " words."] },
    { runs: ["RL ", { text: "right", font: { rtl: true } }, " to left."] },
    { runs: "HD Heading words.", style: "Heading 1" },
  ],
};

describe.each(HOSTS)("scanWordSelectionSpan on %s", (host) => {
  const scan = (target: MockSelectionTarget, document = SV2_MAIN_DOCUMENT) =>
    scanWordSelectionSpan(
      installWordSelectionHost(document, {
        host,
        styles: { Strong: { type: "character", font: { bold: true } } },
      }).ooxml(target),
    );

  it("finds nothing in a plain paragraph", () => {
    expect(scan({ p: "PL1" })).toEqual({
      hazards: {},
      format: {},
      edges: [],
    });
  });

  describe("with a slice", () => {
    const SLICED: MockSelectionDocument = {
      body: [
        {
          runs: [
            "SL first ",
            { text: "bold", font: { bold: true } },
            " last\twords.",
          ],
        },
      ],
    };
    const TEXT = "SL first bold last\twords.";
    const sliced = (start: number, end: number, rangeText = TEXT) =>
      scanWordSelectionSpan(
        installWordSelectionHost(SLICED, { host }).ooxml({ p: "SL" }),
        { start, end, rangeText },
      );

    it("formats a plain word by its own runs and returns the bold run after it as an edge", () => {
      const result = sliced(3, 9);
      expect(result.hazards).toEqual({});
      expect(result.format.bold).toBeUndefined();
      expect(result.edges).toEqual([
        {},
        expect.objectContaining({ bold: true }),
      ]);
    });

    it("gives a slice inside the bold run direct bold", () => {
      expect(sliced(10, 12).format.bold).toEqual({
        state: "direct",
        value: true,
      });
    });

    it("gives a slice half over the bold run mixed bold", () => {
      expect(sliced(6, 11).format.bold).toEqual({ state: "mixed" });
    });

    it("counts a tab as one character", () => {
      const result = sliced(18, 20);
      expect(result.hazards).toEqual({});
      expect(result.edges).toEqual([{}, {}]);
    });

    it("flags runs whose text does not spell the paragraph's text", () => {
      expect(sliced(3, 9, "SL first bold last words.").hazards).toEqual({
        textMismatch: true,
      });
    });

    it("reports superscript on part of a slice, but not a slice all raised or next to one", () => {
      const raised = (start: number, end: number) =>
        scanWordSelectionSpan(
          installWordSelectionHost(
            {
              body: [
                {
                  runs: [
                    "SU Area 12 m",
                    { text: "2", font: { superscript: true } },
                    " and CO",
                    { text: "2", font: { subscript: true } },
                    ".",
                  ],
                },
              ],
            },
            { host },
          ).ooxml({ p: "SU" }),
          { start, end, rangeText: "SU Area 12 m2 and CO2." },
        ).hazards;
      expect(raised(3, 13)).toEqual({ mixedScript: true });
      expect(raised(14, 21)).toEqual({ mixedScript: true });
      expect(raised(12, 13)).toEqual({});
      expect(raised(3, 12)).toEqual({});
    });

    it("does not take an explicit baseline next to unset text for superscript", () => {
      const baseline = scanWordSelectionSpan(
        installWordSelectionHost(
          {
            body: [
              {
                runs: [
                  "BL Lowered ",
                  { text: "back", font: { superscript: false } },
                  " words.",
                ],
              },
            ],
          },
          { host },
        ).ooxml({ p: "BL" }),
        { start: 0, end: 22, rangeText: "BL Lowered back words." },
      );
      expect(baseline.format.superscript).toEqual({ state: "mixed" });
      expect(baseline.hazards).toEqual({});
    });

    it("judges the hazards of the whole paragraph, not only the slice", () => {
      const mixed = SV2_MAIN_DOCUMENT.body[1];
      const result = scanWordSelectionSpan(
        installWordSelectionHost({ body: [mixed] }, { host }).ooxml({
          p: "MX1",
        }),
        { start: 0, end: 3, rangeText: "MX1" },
      );
      expect(result.hazards).toMatchObject({ hyperlink: true, field: true });
    });
  });

  it.each([
    ["MX1", "hyperlink"],
    ["FD1", "field"],
    ["HT1", "hiddenText"],
    ["TC1", "trackedChange"],
    ["CM1", "commentMark"],
    ["FN1", "noteReference"],
    ["PC1", "inlinePicture"],
  ] as const)("reports %s's hazard as %s", (p, hazard) => {
    expect(scan({ p }).hazards).toMatchObject({ [hazard]: true });
  });

  it("reads a uniform direct property as direct and a partial one as mixed", () => {
    expect(scan({ p: "AB" }, DOC).format).toEqual({
      bold: { state: "direct", value: true },
    });
    expect(scan({ p: "MB" }, DOC).format).toEqual({ bold: { state: "mixed" } });
    expect(scan({ p: "CL" }, DOC).format).toEqual({
      color: { state: "direct", value: "#C00000" },
      size: { state: "direct", value: 14 },
    });
    expect(scan({ p: "CP" }, DOC).format).toEqual({
      color: { state: "mixed" },
    });
    expect(scan({ p: "HL" }, DOC).format).toEqual({
      highlightColor: { state: "direct", value: "#FFFF00" },
    });
  });

  it("treats complex-script formatting that differs from its Latin value as a hazard", () => {
    expect(scan({ p: "CS" }, DOC).hazards).toEqual({ complexScript: true });
    expect(scan({ p: "RL" }, DOC).hazards).toEqual({ complexScript: true });
    expect(scan({ p: "RT1" }).hazards).toMatchObject({ complexScript: true });
    expect(scan({ p: "TW" }, DOC).hazards).toEqual({});
  });

  it("refuses a character style", () => {
    expect(scan({ p: "RS" }, DOC).hazards).toEqual({
      unsupportedFormatting: true,
    });
  });

  it("fails closed on a package it cannot read", () => {
    expect(scanWordSelectionSpan("<not ooxml").hazards).toEqual({
      unsupportedFormatting: true,
    });
  });
});

describe.each(HOSTS)("wordSelectionStyleToggles on %s", (host) => {
  it("resolves the paragraph style's toggles by pStyle or by name", () => {
    const word = installWordSelectionHost(DOC, { host });
    const heading = word.ooxml({ p: "HD" });
    expect(
      wordSelectionStyleToggles(
        heading,
        host === "web" ? "heading 1" : "Heading 1",
      ),
    ).toMatchObject({ bold: true, italic: false, underline: "None" });
    expect(
      wordSelectionStyleToggles(word.ooxml({ p: "PL" }), "Normal"),
    ).toMatchObject({ bold: false, italic: false });
    expect(
      wordSelectionStyleToggles(word.ooxml({ p: "PL" }), "No Such Style"),
    ).toBeNull();
  });
});

describe("scanWordSelectionSpan on content it does not know", () => {
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const M = "http://schemas.openxmlformats.org/officeDocument/2006/math";
  const pkg = (paragraph: string) =>
    `<pkg:package xmlns:pkg="http://schemas.microsoft.com/office/2006/xmlPackage"><pkg:part pkg:name="/word/document.xml"><pkg:xmlData><w:document xmlns:w="${W}" xmlns:m="${M}"><w:body>${paragraph}<w:sectPr/></w:body></w:document></pkg:xmlData></pkg:part></pkg:package>`;
  const run = (text: string) => `<w:r><w:t>${text}</w:t></w:r>`;

  it("finds nothing in plain runs with Word's own marks and last-edit bookmark", () => {
    expect(
      scanWordSelectionSpan(
        pkg(
          `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:bookmarkStart w:id="0" w:name="_GoBack"/>${run("Plain")}<w:proofErr w:type="spellStart"/><w:r><w:tab/><w:t>words</w:t></w:r><w:bookmarkEnd w:id="0"/></w:p>`,
        ),
      ).hazards,
    ).toEqual({});
  });

  it.each([
    [
      "an equation",
      `<w:p>${run("Area is ")}<m:oMath><m:r><m:t>πr²</m:t></m:r></m:oMath></w:p>`,
    ],
    [
      "ruby text",
      `<w:p><w:r><w:ruby><w:rt>${run("ka")}</w:rt><w:rubyBase>${run("漢")}</w:rubyBase></w:ruby></w:r></w:p>`,
    ],
    [
      "a permission range",
      `<w:p><w:permStart w:id="2"/>${run("Locked")}<w:permEnd w:id="2"/></w:p>`,
    ],
  ])("keeps %s context only", (_, paragraph) => {
    expect(scanWordSelectionSpan(pkg(paragraph)).hazards).toMatchObject({
      breakOrSymbol: true,
    });
  });

  it.each([
    [
      "a table of contents' bookmark",
      `<w:p><w:bookmarkStart w:id="0" w:name="_Toc938001"/>${run("Heading")}<w:bookmarkEnd w:id="0"/></w:p>`,
    ],
    [
      "a cross-reference's hidden bookmark",
      `<w:p><w:bookmarkStart w:id="0" w:name="_Ref938002"/>${run("7. Signatures")}<w:bookmarkEnd w:id="0"/></w:p>`,
    ],
    [
      "a user's bookmark around a word",
      `<w:p>${run("Plain ")}<w:bookmarkStart w:id="0" w:name="Intro938"/>${run("lima mike")}<w:bookmarkEnd w:id="0"/>${run(" papa.")}</w:p>`,
    ],
    [
      "the end of a bookmark that started in an earlier paragraph",
      `<w:p>${run("Tail")}<w:bookmarkEnd w:id="4"/></w:p>`,
    ],
  ])("reports %s as a bookmark, not as a symbol", (_, paragraph) => {
    expect(scanWordSelectionSpan(pkg(paragraph)).hazards).toEqual({
      bookmark: true,
    });
  });

  it("reports a bookmark's marks between paragraphs as a bookmark", () => {
    expect(
      scanWordSelectionSpan(
        pkg(
          `<w:bookmarkStart w:id="3" w:name="Whole"/><w:p>${run("Page")}</w:p><w:bookmarkEnd w:id="3"/>`,
        ),
      ).hazards,
    ).toEqual({ bookmark: true, breakOrSymbol: true });
    expect(
      scanWordSelectionSpan(
        pkg(
          `<w:bookmarkStart w:id="0" w:name="_GoBack"/><w:p>${run("Page")}</w:p><w:bookmarkEnd w:id="0"/>`,
        ),
      ).hazards,
    ).toEqual({ breakOrSymbol: true });
  });

  it.each([
    ["an inserted", `<w:rPr><w:ins w:id="3" w:author="A"/></w:rPr>`],
    ["a deleted", `<w:rPr><w:del w:id="3" w:author="A"/></w:rPr>`],
    [
      "a reformatted",
      `<w:rPr><w:b/><w:rPrChange w:id="3" w:author="A"><w:rPr/></w:rPrChange></w:rPr>`,
    ],
    [
      "a restyled",
      `<w:pStyle w:val="Heading1"/><w:pPrChange w:id="3" w:author="A"><w:pPr/></w:pPrChange>`,
    ],
  ])("reports %s paragraph mark as a tracked change", (_, pPr) => {
    expect(
      scanWordSelectionSpan(
        pkg(`<w:p><w:pPr>${pPr}</w:pPr>${run("Split")}</w:p>`),
      ).hazards,
    ).toEqual({ trackedChange: true });
  });

  it("keeps a paragraph that holds a section break context only", () => {
    expect(
      scanWordSelectionSpan(
        pkg(`<w:p><w:pPr><w:sectPr/></w:pPr>${run("Last of a section")}</w:p>`),
      ).hazards,
    ).toEqual({ breakOrSymbol: true });
  });
});

describe("wordCellParagraphOoxml", () => {
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const W14 = "http://schemas.microsoft.com/office/word/2010/wordml";
  const pkg = (body: string) =>
    `<?xml version="1.0" standalone="yes"?><?mso-application progid="Word.Document"?><pkg:package xmlns:pkg="http://schemas.microsoft.com/office/2006/xmlPackage"><pkg:part pkg:name="/word/document.xml"><pkg:xmlData><w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>${body}<w:sectPr><w:cols w:space="720"/></w:sectPr></w:body></w:document></pkg:xmlData></pkg:part></pkg:package>`;
  const cell = (content: string) =>
    `<w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/></w:tcPr>${content}</w:tc>`;
  const paragraph = (text: string) =>
    `<w:p w14:paraId="25882142"><w:r><w:t>${text.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</w:t></w:r></w:p>`;
  // Word for Mac 16.113's answer for a paragraph that ends a cell (ERMAIN-928 block 3).
  const row = (
    cells: string,
    rows = 1,
    after = '<w:p w14:paraId="7838ABCE"/>',
  ) =>
    pkg(
      `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr><w:tblGrid><w:gridCol w:w="4500"/><w:gridCol w:w="4500"/></w:tblGrid>${`<w:tr>${cells}</w:tr>`.repeat(rows)}</w:tbl>${after}`,
    );
  const TEXT = "CB2 Cell B2 text <b>";
  const OWN = `<w:body>${paragraph(TEXT)}<w:sectPr>`;
  const ROW = row(cell(paragraph("CA2 Cell A2 text")) + cell(paragraph(TEXT)));

  it("cuts the cell's own paragraph out of desktop's whole row, without the empty paragraph after it", () => {
    const own = wordCellParagraphOoxml(ROW, 1, TEXT);
    expect(own).toMatch(/^<\?xml version="1.0" standalone="yes"\?>/);
    expect(own).not.toContain("w:tbl");
    expect(own).not.toContain("CA2");
    expect(own).not.toContain("7838ABCE");
    expect(own).toContain(OWN.replace("<b>", "&lt;b&gt;"));
    expect(scanWordSelectionSpan(own).hazards).toEqual({});
    expect(scanWordSelectionSpan(ROW).hazards).toEqual({
      breakOrSymbol: true,
    });
  });

  it("cuts the last of several paragraphs in the cell, which is the one that ends it", () => {
    const own = wordCellParagraphOoxml(
      row(
        cell(paragraph("NA1 Outer cell one")) +
          cell(paragraph("NA1b Second") + paragraph(TEXT)),
      ),
      1,
      TEXT,
    );
    expect(own).toContain(OWN.replace("<b>", "&lt;b&gt;"));
    expect(own).not.toContain("NA1b");
  });

  it.each([
    ["another cell's text", ROW, 0],
    ["a cell index past the row", ROW, 2],
    [
      "a cell ending in a nested table",
      row(
        cell(paragraph("CA2")) +
          cell(
            `${paragraph(TEXT)}<w:tbl><w:tr>${cell(paragraph(TEXT))}</w:tr></w:tbl>`,
          ),
      ),
      1,
    ],
    ["two rows", row(cell(paragraph(TEXT)), 2), 0],
    [
      "text after the table",
      row(cell(paragraph(TEXT)), 1, paragraph("After")),
      0,
    ],
  ])("keeps the row, which the scan refuses, for %s", (_, ooxml, index) => {
    expect(wordCellParagraphOoxml(ooxml, index, TEXT)).toBe(ooxml);
  });

  it("leaves a paragraph's own OOXML alone", () => {
    const own = pkg(paragraph("NA1b Second paragraph in outer cell one."));
    expect(
      wordCellParagraphOoxml(
        own,
        0,
        "NA1b Second paragraph in outer cell one.",
      ),
    ).toBe(own);
  });
});
