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
          "Line 1: this item shows as 1., not 3.: a new numbered list always starts at 1. Number it 1.; to continue a list that is already in the document, keep its items by reference or use scoped_edit, or start the line with \\ to keep it as text.",
      },
    ]);
    expect(convert("1. a\n2. b\n4. c").issues).toEqual([
      {
        line: 3,
        message:
          "Line 3: this item shows as 3., not 4.: the items of a list are numbered in order. Number it 3., or start the line with \\ to keep it as text.",
      },
    ]);
    expect(convert("1. a\n1. b\n2. c").issues).toEqual([
      expect.objectContaining({ line: 3 }),
    ]);
    expect(convert("1. a\n2. b\n3. c").issues).toEqual([]);
  });

  it("keeps a list across blank lines, numbers all-1. items in order and starts a new list at a later 1.", () => {
    const lists = (text: string) => {
      const { blocks, issues } = convert(text);
      expect(issues).toEqual([]);
      return blocks.map((b) => (b.type === "list-item" ? b.list : b.type));
    };
    expect(lists("1. a\n\n2. b\n\n  - c\n\n3. d")).toEqual([
      "r1_1_list1",
      "r1_1_list1",
      "r1_1_list2",
      "r1_1_list1",
    ]);
    expect(lists("1. a\n1. b\n1. c")).toEqual([
      "r1_1_list1",
      "r1_1_list1",
      "r1_1_list1",
    ]);
    expect(lists("1. a\n2. b\n1. c")).toEqual([
      "r1_1_list1",
      "r1_1_list1",
      "r1_1_list2",
    ]);
    expect(lists("1. a\nText\n1. b")).toEqual([
      "r1_1_list1",
      "paragraph",
      "r1_1_list2",
    ]);
  });

  it("converts a table with a header row in the document's table style", () => {
    const { blocks, origins, issues } = convert(
      "| Zone | Frist |\n|---|---|\n| A | **2** Tage |\n| B |  |",
      { table: { styleRef: "Gitternetz", headerLook: true } },
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

  it("bolds a header row whose table style gives it no look of its own, and marks no header without |---|", () => {
    for (const table of [undefined, { styleRef: "TableGrid" }]) {
      const [header] = convert("| a | b |\n|---|\n| 1 | 2 |", {
        table,
      }).blocks;
      expect(header).toMatchObject({ format: { firstRow: true } });
      expect(header.type === "table" && header.rows[0].cells[0].blocks).toEqual(
        [
          {
            id: "r1_1_1",
            type: "paragraph",
            text: "a",
            runs: [{ text: "a", bold: true }],
          },
        ],
      );
    }
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

describe("a part's new text with every construct of the form", () => {
  it("converts without a slip", () => {
    const { blocks, issues } = convert(
      [
        "### 4.1 Opening hours",
        "The office is open **on weekdays** and *by appointment*.",
        "- Mornings",
        "  - from 8 am",
        "",
        "- Afternoons",
        "1. Register",
        "2. Wait for the reply",
        "| Day | Hours |",
        "|---|---|",
        "| Monday | 8–16 |",
        "\\1. is a number, not a list.",
      ].join("\n"),
    );
    expect(issues).toEqual([]);
    expect(
      blocks.map((b) => (b.type === "list-item" ? [b.list, b.level] : b.type)),
    ).toEqual([
      "heading",
      "paragraph",
      ["r1_1_list1", 0],
      ["r1_1_list2", 1],
      ["r1_1_list1", 0],
      ["r1_1_list3", 0],
      ["r1_1_list3", 0],
      "table",
      "paragraph",
    ]);
    expect(blocks.at(-1)?.text).toBe("1. is a number, not a list.");
    for (const block of blocks) expect(parseWordBlock(block)).not.toBeNull();
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
    { id: "Gitternetz", name: "Table Grid,Raster", type: "table" },
    {
      id: "Hell",
      name: "Grid Table 1 Light",
      type: "table",
      firstRowLook: true as const,
    },
    { id: "TableNormal", name: "Normal Table", type: "table" },
  ];

  it("is the style most of its tables use, else a defined Table Grid", () => {
    expect(
      wordDocumentTableStyle({
        blocks: [table("b1", "Hell"), table("b2", "Hell"), table("b3")],
        styles,
      }),
    ).toEqual({ styleRef: "Hell", headerLook: true });
    expect(
      wordDocumentTableStyle({
        blocks: [
          table("b1", "TableNormal"),
          table("b2", "TableNormal"),
          table("b3", "Gitternetz"),
        ],
        styles,
      }),
    ).toEqual({ styleRef: "Gitternetz" });
    expect(wordDocumentTableStyle({ blocks: [], styles })).toEqual({
      styleRef: "Gitternetz",
    });
    expect(wordDocumentTableStyle({ blocks: [], styles: [] })).toEqual({});
  });
});
