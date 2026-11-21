import { describe, expect, it } from "vitest";

import { wordDocumentTableStyle, wordPlainTextBlocks } from "../wordPlainText";
import { parseWordBlock } from "../wordRichPlan";

import type { WordSourceBlock } from "../wordDocumentPlan";

const convert = (text: string, options = {}) =>
  wordPlainTextBlocks(text, { idPrefix: "r1_1", ...options });

const source = (
  ref: string,
  type: WordSourceBlock["type"],
  styleRef?: string,
): WordSourceBlock => ({
  ref,
  type,
  text: "",
  protected: false,
  xml: "",
  ...(styleRef ? { styleRef } : {}),
});

describe("the plain-text form", () => {
  it("turns each non-empty line into one typed block", () => {
    const { blocks, origins, issues } = convert(
      "# Lieferung\n\n(1) Der **Auftragnehmer** liefert *pünktlich*.\n\\# kein Titel\n### Fristen",
    );
    expect(issues).toEqual([]);
    expect(blocks).toEqual([
      { id: "r1_1_1", type: "heading", level: 1, text: "Lieferung" },
      {
        id: "r1_1_2",
        type: "paragraph",
        text: "(1) Der Auftragnehmer liefert pünktlich.",
        runs: [
          { text: "(1) Der " },
          { text: "Auftragnehmer", bold: true },
          { text: " liefert " },
          { text: "pünktlich", italic: true },
          { text: "." },
        ],
      },
      { id: "r1_1_3", type: "paragraph", text: "# kein Titel" },
      { id: "r1_1_4", type: "heading", level: 3, text: "Fristen" },
    ]);
    expect(origins.map((o) => o.line)).toEqual([1, 3, 4, 5]);
    for (const block of blocks) expect(parseWordBlock(block)).not.toBeNull();
  });

  it("keeps a lone star as text", () => {
    expect(convert("Preis* zzgl. 5 * 3").blocks[0]).toEqual({
      id: "r1_1_1",
      type: "paragraph",
      text: "Preis* zzgl. 5 * 3",
    });
  });

  it("builds lists by level, with numbered and bulleted levels as their own lists", () => {
    const { blocks, issues } = convert(
      "1. Abruf\n  - bis 14 Uhr\n  - im Portal\n2. Lieferung\n    1. DAP\n\n- neu",
    );
    expect(issues).toEqual([]);
    expect(
      blocks.map((b) =>
        b.type === "list-item" ? [b.list, b.level, b.ordered, b.text] : b.type,
      ),
    ).toEqual([
      ["r1_1_list1", 0, true, "Abruf"],
      ["r1_1_list2", 1, false, "bis 14 Uhr"],
      ["r1_1_list2", 1, false, "im Portal"],
      ["r1_1_list1", 0, true, "Lieferung"],
      ["r1_1_list3", 1, true, "DAP"],
      ["r1_1_list4", 0, false, "neu"],
    ]);
  });

  it("names the line of a number Word would show differently", () => {
    expect(convert("3. Lieferung").issues).toEqual([
      {
        line: 1,
        message:
          "Line 1: this item shows as 1., not 3.: a new numbered list always starts at 1. Number it 1., or start the line with \\ to keep it as text.",
      },
    ]);
    expect(convert("1. a\n1. b\n2. c").issues).toEqual([
      expect.objectContaining({ line: 3 }),
    ]);
    expect(convert("1. a\n2. b\n3. c").issues).toEqual([]);
  });

  it("converts a table with a header row in the document's table style", () => {
    const { blocks, origins, issues } = convert(
      "| Zone | Frist |\n|---|---|\n| A | **2** Tage |\n| B |  |",
      { tableStyle: "Gitternetz" },
    );
    expect(issues).toEqual([]);
    expect(origins).toEqual([{ line: 1, rows: [1, 3, 4] }]);
    const [table] = blocks;
    expect(table).toMatchObject({
      type: "table",
      format: { styleRef: "Gitternetz", firstRow: true },
      rows: [
        {
          format: { repeatHeader: true },
          cells: [
            { blocks: [{ type: "paragraph", text: "Zone" }] },
            { blocks: [{ type: "paragraph", text: "Frist" }] },
          ],
        },
        {
          cells: [
            { blocks: [{ text: "A" }] },
            {
              blocks: [
                {
                  text: "2 Tage",
                  runs: [{ text: "2", bold: true }, { text: " Tage" }],
                },
              ],
            },
          ],
        },
        { cells: [{ blocks: [{ text: "B" }] }, { blocks: [] }] },
      ],
    });
    expect(parseWordBlock(table)).not.toBeNull();
  });

  it("bolds the header row of a table that has no table style, and marks no header without |---|", () => {
    const [header] = convert("| a | b |\n|---|---|\n| 1 | 2 |").blocks;
    expect(header).toMatchObject({ format: { firstRow: true } });
    expect(header.type === "table" && header.rows[0].cells[0].blocks).toEqual([
      {
        id: "r1_1_1",
        type: "paragraph",
        text: "a",
        runs: [{ text: "a", bold: true }],
      },
    ]);
    expect(convert("| a | b |\n| 1 | 2 |").blocks[0]).toMatchObject({
      format: { firstRow: false },
    });
  });

  it("names the line of a broken table row", () => {
    const { blocks, issues } = convert(
      "Intro\n| Zone | Frist |\n|---|---|\n| A | 2 Tage | x |\n| B | 3 Tage",
    );
    expect(blocks.map((b) => b.type)).toEqual(["paragraph"]);
    expect(issues).toEqual([
      {
        line: 4,
        message:
          "Line 4: this table row has 3 cells, but the table's first row (line 2) has 2; give every row of a table the same number of cells, leaving a cell empty as | |.",
      },
      {
        line: 5,
        message:
          "Line 5: a table row starts and ends with |; put every cell between bars, like | a | b |.",
      },
    ]);
  });

  it("names a misplaced header line, a line break in a cell and an unclosed bold", () => {
    const lines = (text: string) => convert(text).issues.map((i) => i.line);
    expect(lines("| a |\n| b |\n|---|")).toEqual([3]);
    expect(lines("| a<br>b |")).toEqual([1]);
    expect(lines("Text\n**fett ohne Ende")).toEqual([2]);
    expect(lines("```\n---")).toEqual([1, 2]);
    expect(lines("####### zu tief")).toEqual([1]);
  });

  it("gives a replacing line the style of the paragraph it takes the place of", () => {
    const { blocks } = convert(
      "Erster Satz.\nZweiter Satz.\n- Punkt\n# Titel",
      {
        replaced: [
          source("b1", "paragraph", "Vertragstext"),
          source("b2", "paragraph"),
          source("b3", "list-item", "ListParagraph"),
        ],
      },
    );
    expect(blocks.map((b) => [b.type, b.styleRef])).toEqual([
      ["paragraph", "Vertragstext"],
      ["paragraph", undefined],
      ["list-item", "ListParagraph"],
      ["heading", undefined],
    ]);
  });
});

describe("the package prompt's plain-text example", () => {
  it("converts without a slip", () => {
    const { blocks, issues } = convert(
      [
        "## 3.2 Delivery times",
        "(1) The supplier delivers **within 14 days** of the call-off.",
        "- Monday to Friday: delivery until 2 pm",
        "  - except on *public holidays*",
        "1. Call-off in the ordering portal",
        "2. Confirmation by the supplier",
        "| Zone | Deadline |",
        "|---|---|",
        "| A | 2 days |",
        "\\- 5 °C is the lowest storage temperature.",
      ].join("\n"),
    );
    expect(issues).toEqual([]);
    expect(blocks.map((b) => b.type)).toEqual([
      "heading",
      "paragraph",
      "list-item",
      "list-item",
      "list-item",
      "list-item",
      "table",
      "paragraph",
    ]);
    expect(blocks.at(-1)?.text).toBe(
      "- 5 °C is the lowest storage temperature.",
    );
  });
});

describe("the document's table style", () => {
  const table = (ref: string, styleRef?: string) =>
    ({
      ...source(ref, "native"),
      nativeKind: "table",
      content: {
        columns: [],
        format: styleRef ? { styleRef } : {},
        rows: [],
        sourcePatchSupported: true,
      },
    }) as WordSourceBlock;
  const styles = [
    { id: "Gitternetz", name: "Table Grid", type: "table" },
    { id: "Hell", name: "Grid Table 1 Light", type: "table" },
  ];

  it("is the style most of its tables use, else a defined Table Grid", () => {
    expect(
      wordDocumentTableStyle({
        blocks: [table("b1", "Hell"), table("b2", "Hell"), table("b3")],
        styles,
      }),
    ).toBe("Hell");
    expect(wordDocumentTableStyle({ blocks: [], styles })).toBe("Gitternetz");
    expect(wordDocumentTableStyle({ blocks: [], styles: [] })).toBeUndefined();
  });
});
