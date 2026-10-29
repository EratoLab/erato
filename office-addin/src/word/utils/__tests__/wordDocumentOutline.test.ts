import { describe, expect, it } from "vitest";

import { packageXml } from "../../../test/mocks/word/authoringFixtures";
import {
  body,
  chapter,
  clauseText,
  heading,
  sectionSnapshot,
} from "../../../test/mocks/word/sectionFixtures";
import {
  resolveWordActionFacet,
  WORD_AUTHORING_FACET_ID,
} from "../wordActionFacet";
import {
  wordCaptureSections,
  wordDocumentOutline,
  wordDocumentOutlineText,
  wordOutlineLine,
} from "../wordDocumentOutline";
import { captureWordAuthoringSnapshot } from "../wordDocumentXml";

import type { SectionBlock } from "../../../test/mocks/word/sectionFixtures";

const utf8 = (s: string) => new TextEncoder().encode(s).length;
const numbered = (list: string, level: number, text: string): SectionBlock => ({
  type: "list-item",
  level,
  list,
  ordered: true,
  text,
});
const clauses = (count: number, seed = 0) =>
  Array.from({ length: count }, (_, k) => body(clauseText(seed + k)));
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const run = (text: string) => `<w:r><w:t>${text}</w:t></w:r>`;

describe("heading outline", () => {
  it("lists every heading with level, title, size and paragraphs, after the start of the document", () => {
    const longTitle = `${"Überschrift 😀 ".repeat(8)}end`;
    const snapshot = sectionSnapshot([
      body("Master Services Agreement"),
      body("between the parties"),
      heading(1, longTitle),
      ...clauses(3),
      heading(2, "Defined terms"),
      ...clauses(2),
      {
        type: "list-item",
        level: 0,
        list: "existing-4",
        ordered: true,
        styleRef: "Heading2",
        text: "Numbered heading",
      },
      ...clauses(2),
      heading(1, "Fees"),
      body(""),
    ]);
    const outline = wordDocumentOutline(snapshot);

    expect(outline.map((e) => [e.ref, e.tag, e.level, e.paragraphs])).toEqual([
      ["b1", "H", 1, 2],
      ["b3", "H", 1, 10],
      ["b7", "H", 2, 3],
      ["b10", "H", 2, 3],
      ["b13", "H", 1, 2],
    ]);
    expect(outline[0].title).toBe("(start of document)");
    expect(Array.from(outline[1].title)).toHaveLength(80);
    expect(longTitle.startsWith(outline[1].title)).toBe(true);
    expect(wordOutlineLine(outline[2])).toMatch(
      /^\[b7\|H2\|\d+\.\d KiB\|3 ¶\] Defined terms$/,
    );
  });

  it("knows heading styles by name and counts a heading-styled list item", () => {
    const snapshot = sectionSnapshot(
      [
        { type: "paragraph", styleRef: "berschrift1", text: "Gegenstand" },
        ...clauses(2),
        {
          type: "list-item",
          level: 1,
          list: "existing-2",
          ordered: true,
          styleRef: "berschrift2",
          text: "Leistungen",
        },
        ...clauses(2),
      ],
      {},
    );
    snapshot.styles.push(
      { id: "berschrift1", name: "heading 1", type: "paragraph" },
      { id: "berschrift2", name: "heading 2", type: "paragraph" },
    );
    expect(
      wordDocumentOutline(snapshot).map((e) => [e.ref, e.tag, e.level]),
    ).toEqual([
      ["b1", "H", 1],
      ["b4", "H", 2],
    ]);
  });

  it("knows a heading style whose name carries aliases", () => {
    const snapshot = sectionSnapshot([
      numbered("existing-1", 0, "Gegenstand"),
      ...clauses(2),
      numbered("existing-1", 0, "Leistungen"),
      ...clauses(2),
    ]);
    snapshot.blocks[0].styleRef = snapshot.blocks[3].styleRef = "berschrift1";
    snapshot.styles.push({
      id: "berschrift1",
      name: "heading 1,h1",
      type: "paragraph",
    });
    expect(
      wordDocumentOutline(snapshot).map((e) => [e.ref, e.tag, e.level]),
    ).toEqual([
      ["b1", "H", 1],
      ["b4", "H", 1],
    ]);
  });

  it("counts numbered paragraphs in custom styles by their captured outline level", () => {
    const style = (id: string, level: number) =>
      `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${id}"/><w:pPr><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="1"/></w:numPr><w:outlineLvl w:val="${level}"/></w:pPr></w:style>`;
    const numbering = `<pkg:part pkg:name="/word/numbering.xml" pkg:contentType="application/xml"><pkg:xmlData><w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering></pkg:xmlData></pkg:part>`;
    const paragraph = (text: string, styleId?: string) =>
      `<w:p>${styleId ? `<w:pPr><w:pStyle w:val="${styleId}"/></w:pPr>` : ""}${run(text)}</w:p>`;
    const xml = packageXml(
      [
        paragraph("Vertrag"),
        ...[1, 2].flatMap((n) => [
          paragraph(`Kapitel ${n}`, "Gliederung1"),
          paragraph("Text"),
          paragraph(`Abschnitt ${n}.1`, "Gliederung2"),
          paragraph("Text"),
        ]),
      ].join(""),
    )
      .replace(
        "</w:styles>",
        `${style("Gliederung1", 0)}${style("Gliederung2", 1)}</w:styles>`,
      )
      .replace("</pkg:package>", `${numbering}</pkg:package>`);
    const snapshot = captureWordAuthoringSnapshot(xml, "doc-G", "Off");

    expect(snapshot.blocks[1]).toMatchObject({ type: "list-item", level: 0 });
    expect(
      wordDocumentOutline(snapshot).map((e) => [e.tag, e.level, e.title]),
    ).toEqual([
      ["H", 1, "(start of document)"],
      ["H", 1, "Kapitel 1"],
      ["H", 2, "Abschnitt 1.1"],
      ["H", 1, "Kapitel 2"],
      ["H", 2, "Abschnitt 2.1"],
    ]);
    expect(
      JSON.stringify(wordCaptureSections(snapshot).readable),
    ).not.toContain("outlineLevel");
  });

  it("maps every block to the deepest entry that holds it", () => {
    const snapshot = sectionSnapshot([
      heading(1, "One"),
      body("intro"),
      heading(2, "One.one"),
      body("text"),
      heading(1, "Two"),
    ]);
    const { entryOf, outline } = wordCaptureSections(snapshot);
    expect(Array.from(entryOf, (k) => outline[k].ref)).toEqual([
      "b1",
      "b1",
      "b3",
      "b3",
      "b5",
    ]);
  });
});

describe("fallback outline without headings", () => {
  it("takes Word-numbered top-level items as sections, with the front matter as its own", () => {
    const blocks: SectionBlock[] = [
      { type: "paragraph", styleRef: "Title", text: "Rahmenvertrag" },
      body("zwischen A und B"),
      ...[1, 2, 3, 4].flatMap((n) => [
        numbered("existing-1", 0, `Section ${n}`),
        numbered("existing-1", 1, `${n}.1 clause`),
        ...clauses(3, n),
        numbered("existing-9", 0, "(a) enumeration"),
        numbered("existing-9", 0, "(b) enumeration"),
        numbered("existing-9", 0, "(c) enumeration"),
      ]),
    ];
    const outline = wordDocumentOutline(sectionSnapshot(blocks));

    expect(outline.map((e) => [e.ref, e.tag, e.level])).toEqual([
      ["b1", "S", 1],
      ["b3", "S", 1],
      ["b11", "S", 1],
      ["b19", "S", 1],
      ["b27", "S", 1],
    ]);
    expect(outline[0].title).toBe("Rahmenvertrag");
    expect(outline[1].title).toBe("Section 1");
  });

  it("starts the first section at the document start when only empty paragraphs precede it", () => {
    const blocks: SectionBlock[] = [
      body(""),
      body(""),
      ...[1, 2, 3].flatMap((n) => [
        numbered("existing-1", 0, `Section ${n}`),
        ...clauses(3, n),
      ]),
    ];
    expect(
      wordDocumentOutline(sectionSnapshot(blocks)).map((e) => [
        e.ref,
        e.tag,
        e.title,
      ]),
    ).toEqual([
      ["b1", "S", "Section 1"],
      ["b7", "S", "Section 2"],
      ["b11", "S", "Section 3"],
    ]);
  });

  it("parts a numbered section above 60 KiB from its second block, so every entry has its own ref", () => {
    const blocks: SectionBlock[] = [
      body("Rahmenvertrag"),
      ...[2, 190, 2].flatMap((count, k) => [
        numbered("existing-1", 0, `Section ${k + 1}`),
        ...clauses(count, k),
      ]),
    ];
    const outline = wordDocumentOutline(sectionSnapshot(blocks));
    const large = outline.findIndex((e) => e.title === "Section 2");

    expect(outline[large]).toMatchObject({ tag: "S", level: 1 });
    expect(outline[large].kib).toBeGreaterThan(60);
    expect(outline[large + 1]).toMatchObject({
      tag: "P",
      level: 2,
      from: outline[large].from + 1,
    });
    expect(new Set(outline.map((e) => e.ref)).size).toBe(outline.length);
  });

  it("takes the longest run of typed top-level numbers, never 1.1 or an enumeration", () => {
    const blocks: SectionBlock[] = [
      body("Preamble"),
      ...[1, 2, 3].flatMap((n) => [
        body(`§ ${n} Subject ${n}`),
        body(`${n}.1 The first clause of section ${n}`),
        body(`1. the Supplier shall comply;`),
        ...clauses(2, n),
      ]),
    ];
    const outline = wordDocumentOutline(sectionSnapshot(blocks));
    expect(outline.map((e) => [e.ref, e.tag, e.title])).toEqual([
      ["b1", "S", "Preamble"],
      ["b2", "S", "§ 1 Subject 1"],
      ["b7", "S", "§ 2 Subject 2"],
      ["b12", "S", "§ 3 Subject 3"],
    ]);
  });

  it("cuts a body without numbering into parts of at most 20 KiB that start at a clause", () => {
    const blocks: SectionBlock[] = [];
    for (let k = 0; k < 40; k++) blocks.push(...clauses(5, k * 5), body(""));
    const snapshot = sectionSnapshot(blocks);
    const sections = wordCaptureSections(snapshot);
    const outline = wordDocumentOutline(snapshot);

    expect(outline.length).toBeGreaterThan(3);
    expect(outline.every((e) => e.tag === "P" && e.level === 1)).toBe(true);
    for (const [k, e] of outline.entries()) {
      expect(sections.spanBytes(e.from, e.to)).toBeLessThanOrEqual(20 * 1024);
      if (k > 0) expect(snapshot.blocks[e.from - 1].text).toBe("");
    }
    expect(outline[outline.length - 1].to).toBe(snapshot.blocks.length);
  });

  it("parts a heading's own text above 60 KiB, and the start of the document", () => {
    const snapshot = sectionSnapshot([
      ...clauses(170),
      heading(1, "Annex"),
      ...clauses(170, 3),
      heading(1, "Signatures"),
      body("Signed"),
    ]);
    const outline = wordDocumentOutline(snapshot);
    const annex = outline.findIndex((e) => e.title === "Annex");

    expect(outline.slice(0, annex).every((e) => e.tag === "P")).toBe(true);
    expect(outline[annex]).toMatchObject({ tag: "H", level: 1 });
    const parts = outline.slice(annex + 1, -1);
    expect(parts.length).toBeGreaterThan(2);
    expect(parts.every((e) => e.tag === "P" && e.level === 2)).toBe(true);
    expect(parts[0].from).toBe(outline[annex].from + 1);
    expect(outline[outline.length - 1].title).toBe("Signatures");
  });
});

describe("outline text", () => {
  it("stays within 8 KiB and 300 entries, dropping the deepest level first", () => {
    const blocks: SectionBlock[] = [];
    for (let c = 1; c <= 12; c++) {
      blocks.push(heading(1, `Chapter ${c}`));
      for (let s = 1; s <= 30; s++)
        blocks.push(heading(2, `Section ${c}.${s} on a subject`), body("x"));
    }
    const text = wordDocumentOutlineText(sectionSnapshot(blocks));
    const lines = text.split("\n");

    expect(utf8(text)).toBeLessThanOrEqual(8192);
    expect(lines.filter((l) => l.startsWith("[")).length).toBe(12);
    expect(lines.some((l) => l.includes("|H2|"))).toBe(false);
    expect(lines[lines.length - 1]).toBe(
      "360 more entries are left out; section:{ref, throughRef} reads any range of blocks.",
    );
  });

  it("cuts the tail when one level alone is too long", () => {
    const blocks = Array.from({ length: 400 }, (_, k) =>
      heading(1, `Chapter ${k + 1}`),
    );
    const text = wordDocumentOutlineText(sectionSnapshot(blocks));
    const lines = text.split("\n");
    const entries = lines.filter((l) => l.startsWith("["));

    expect(utf8(text)).toBeLessThanOrEqual(8192);
    expect(entries.length).toBeLessThanOrEqual(300);
    expect(entries.length).toBeGreaterThan(200);
    expect(entries[entries.length - 1]).toContain(`Chapter ${entries.length}`);
    expect(lines[lines.length - 1]).toBe(
      `${400 - entries.length} more entries are left out; section:{ref, throughRef} reads any range of blocks.`,
    );
  });

  it("goes into heading_outline only for a capture too large for a complete read", () => {
    const facet = (completeReadIssue?: "too-large") =>
      resolveWordActionFacet({
        chipEnabled: true,
        documentName: "Contract.docx",
        documentIdentity: "doc",
        documentArgs: {
          document_text: "",
          heading_outline: "",
          paragraphs_sent: "0",
          paragraphs_total: "60",
          truncation_note: "",
        },
        hasContent: true,
        authoring: sectionSnapshot(chapter(1, 4), { completeReadIssue }),
        availableFacetIds: new Set([WORD_AUTHORING_FACET_ID]),
      })?.args as Record<string, string>;

    const large = facet("too-large");
    expect(large.heading_outline).toMatch(/^Each line: \[ref\|/);
    expect(large.heading_outline).toContain("|H1|");
    expect(large.authoring_status).toMatch(/^available /);
    expect(large.authoring_status).toContain("section:{ref}");
    expect(large.authoring_status).toContain("the Outline");
    expect(large.truncation_note).toContain("the Outline");
    expect(Object.values(large).join("\n")).not.toContain("heading_outline");
    expect(facet().heading_outline).toBe("");
  });
});
