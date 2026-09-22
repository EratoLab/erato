import { describe, expect, it } from "vitest";

import {
  packageXml,
  paragraph,
  readySnapshot,
  W,
} from "../../../test/mocks/word/authoringFixtures";
import {
  mixedAuthoringXml,
  nativeImage,
  nativeTable,
} from "../../../test/mocks/word/mixedAuthoringFixtures";
import {
  parseWordDocumentPlan,
  validateWordDocumentPlan,
} from "../wordDocumentPlan";
import {
  captureWordAuthoringSnapshot,
  compileWordDocumentPlan,
  verifyWordPlanOutput,
} from "../wordDocumentXml";

import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
} from "../wordDocumentPlan";

const tableStyle =
  '<w:style w:type="table" w:styleId="PilotTable"><w:name w:val="Pilot table"/><w:tblPr><w:tblBorders><w:bottom w:val="single" w:sz="4"/></w:tblBorders></w:tblPr></w:style>';
const withTableStyle = (xml: string) =>
  xml.replace("</w:styles>", `${tableStyle}</w:styles>`);
const p = (id: string, text: string) => ({ id, type: "paragraph", text });
const plan = (
  source: WordAuthoringSnapshot,
  blocks: unknown[],
  replace = source.blocks.map((b) => b.ref),
): WordDocumentPlan =>
  parseWordDocumentPlan(
    JSON.stringify({
      version: 1,
      snapshot: source.token,
      readToken: "read-proof",
      scope: "body",
      entries: [
        { kind: "replace", source: replace, blocks },
        ...source.blocks
          .filter((b) => !replace.includes(b.ref))
          .map((b) => ({ kind: "keep", source: [b.ref] })),
      ],
      deleted: [],
    }),
  )!;
const apply = (source: WordAuthoringSnapshot, proposed: WordDocumentPlan) => {
  expect(proposed).not.toBeNull();
  expect(validateWordDocumentPlan(proposed, source)).toBeNull();
  const xml = compileWordDocumentPlan(proposed, source);
  const after = captureWordAuthoringSnapshot(xml, source.identity, "Off");
  expect(after.issue).toBeUndefined();
  expect(verifyWordPlanOutput(proposed, source, after)).toBe(true);
  return { xml, after };
};

describe("integrated rich table and formatting plans", () => {
  it("creates styled native tables with cell headings, lists, multiple paragraphs and merges", () => {
    const source = readySnapshot(
      withTableStyle(packageXml(paragraph("Previous document"))),
    );
    const proposed = plan(source, [
      {
        id: "new-table",
        type: "table",
        columns: [140, 180],
        format: {
          styleRef: "PilotTable",
          layout: "fixed",
          firstRow: true,
          bandedRows: true,
        },
        rows: [
          {
            format: { repeatHeader: true },
            cells: [
              {
                blocks: [
                  { id: "h1", type: "heading", level: 2, text: "Region" },
                ],
              },
              {
                blocks: [
                  { id: "h2", type: "heading", level: 2, text: "Action" },
                ],
              },
            ],
          },
          {
            cells: [
              { rowSpan: 2, blocks: [p("region", "North")] },
              {
                blocks: [
                  {
                    id: "l1",
                    type: "list-item",
                    text: "Confirm budget",
                    list: "actions",
                    level: 0,
                    ordered: true,
                  },
                ],
              },
            ],
          },
          {
            cells: [
              {
                blocks: [
                  {
                    id: "l2",
                    type: "list-item",
                    text: "Start pilot",
                    list: "actions",
                    level: 0,
                    ordered: true,
                  },
                  p("details", "Review progress in October."),
                ],
              },
            ],
          },
        ],
      },
    ]);
    const { after, xml } = apply(source, proposed);
    expect(source.styles).toContainEqual({
      id: "PilotTable",
      name: "Pilot table",
      type: "table",
    });
    const table = after.blocks.find((b) => b.nativeKind === "table")!.content!;
    expect(table.format).toMatchObject({
      styleRef: "PilotTable",
      layout: "fixed",
      firstRow: true,
      bandedRows: true,
    });
    expect(table.rows[1].cells[0]).toMatchObject({ rowSpan: 2, text: "North" });
    expect(table.rows[2].cells[0].text).toBe(
      "Start pilot\nReview progress in October.",
    );
    expect(xml).toContain("<w:numPr>");
  });

  it("changes one cell, reorders rows, and preserves the native field and image in an untouched cell", () => {
    const field =
      '<w:p><w:fldSimple w:instr="MERGEFIELD BudgetCode"><w:r><w:t>CODE-42</w:t></w:r></w:fldSimple></w:p>';
    const richerTable = nativeTable.replace(
      paragraph("North"),
      paragraph("North") + nativeImage + field,
    );
    const source = readySnapshot(
      withTableStyle(
        mixedAuthoringXml()
          .replace(nativeImage, "")
          .replace(nativeTable, richerTable),
      ),
    );
    const originalTable = source.blocks.find((b) => b.nativeKind === "table")!;
    const proposed = plan(
      source,
      [
        {
          id: "revised-table",
          type: "table",
          sourceRef: originalTable.ref,
          format: { styleRef: "PilotTable", caption: "Regional pilot" },
          rows: [
            {
              sourceIndex: 1,
              cells: [
                { sourceIndex: 0 },
                { sourceIndex: 1, blocks: [p("budget", "€48,000")] },
              ],
            },
            { sourceIndex: 0, cells: [{ sourceIndex: 0 }, { sourceIndex: 1 }] },
          ],
        },
      ],
      [originalTable.ref],
    );
    const { after, xml } = apply(source, proposed);
    const table = after.blocks.find((b) => b.nativeKind === "table")!.content!;
    expect(table.rows[0].cells[0].text).toContain("CODE-42");
    expect(table.rows[0].cells[1].text).toBe("€48,000");
    expect(table.rows[1].cells.map((cell) => cell.text)).toEqual([
      "Region",
      "Budget",
    ]);
    expect(xml).toContain('w:instr="MERGEFIELD BudgetCode"');
    expect(xml).toContain('descr="Synthetic one pixel test image"');
    expect(xml).toContain("iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB");
    expect(
      verifyWordPlanOutput(
        proposed,
        source,
        captureWordAuthoringSnapshot(
          xml.replace("CODE-42", "LOST"),
          source.identity,
          "Off",
        ),
      ),
    ).toBe(false);
    expect(
      verifyWordPlanOutput(
        proposed,
        source,
        captureWordAuthoringSnapshot(
          xml.replace('cx="914400"', 'cx="1828800"'),
          source.identity,
          "Off",
        ),
      ),
    ).toBe(false);
  });

  it("applies paragraph and individual run formatting and detects loss of a requested mark", () => {
    const source = readySnapshot(packageXml(paragraph("Old plain paragraph")));
    const proposed = plan(source, [
      {
        id: "formatted",
        type: "paragraph",
        text: "A focused recommendation",
        format: {
          alignment: "center",
          spacingBefore: 12,
          spacingAfter: 8,
          indentLeft: 18,
          firstLineIndent: -9,
          lineSpacing: { value: 1.2, rule: "multiple" },
          font: { fontFamily: "Aptos", fontSize: 12, color: "223344" },
          shading: "F1F5F9",
          borders: { bottom: { style: "single", color: "445566", width: 0.5 } },
        },
        runs: [
          { text: "A focused ", bold: true, highlight: "yellow" },
          {
            text: "recommendation",
            italic: true,
            fontSize: 13,
            color: "AA1122",
          },
        ],
      },
    ]);
    const { after, xml } = apply(source, proposed);
    expect(after.blocks[0].format).toMatchObject({
      alignment: "center",
      spacingBefore: 12,
      spacingAfter: 8,
      firstLineIndent: -9,
    });
    expect(after.blocks[0].runs).toMatchObject([
      {
        text: "A focused ",
        bold: true,
        fontFamily: "Aptos",
        fontSize: 12,
        color: "223344",
        highlight: "yellow",
      },
      {
        text: "recommendation",
        italic: true,
        fontFamily: "Aptos",
        fontSize: 13,
        color: "AA1122",
      },
    ]);
    const changed = xml.replace(
      '<w:highlight w:val="yellow"/>',
      '<w:highlight w:val="none"/>',
    );
    expect(
      verifyWordPlanOutput(
        proposed,
        source,
        captureWordAuthoringSnapshot(changed, source.identity, "Off"),
      ),
    ).toBe(false);
  });

  it("keeps adjacent new tables separate and verifies the separating paragraph", () => {
    const source = readySnapshot(packageXml(paragraph("Previous")));
    const proposed = plan(
      source,
      ["A", "B"].map((text) => ({
        id: `table-${text}`,
        type: "table",
        rows: [{ cells: [{ blocks: [p(`cell-${text}`, text)] }] }],
      })),
    );
    const { after } = apply(source, proposed);
    expect(after.blocks.map((b) => b.nativeKind ?? b.type)).toEqual([
      "table",
      "paragraph",
      "table",
    ]);
  });

  it("rejects unresolved table references and non-table or missing table styles", () => {
    const source = readySnapshot(
      withTableStyle(packageXml(paragraph("Previous"))),
    );
    for (const extra of [
      { sourceRef: "missing" },
      { format: { styleRef: "Missing" } },
      { format: { styleRef: "Normal" } },
    ]) {
      const proposed = plan(source, [
        {
          id: "new-table",
          type: "table",
          ...extra,
          rows: [{ cells: [{ blocks: [p("cell", "A")] }] }],
        },
      ]);
      expect(proposed).not.toBeNull();
      expect(validateWordDocumentPlan(proposed, source)).toBe("invalid");
    }
  });

  it("rejects duplicate nested block IDs across cells before compilation", () => {
    const source = readySnapshot(packageXml(paragraph("Previous")));
    const proposed = plan(source, [
      {
        id: "table",
        type: "table",
        rows: [
          {
            cells: [{ blocks: [p("same", "A")] }, { blocks: [p("same", "B")] }],
          },
        ],
      },
    ]);
    expect(validateWordDocumentPlan(proposed, source)).toBe("invalid");
  });

  it("does not confuse a source paragraph reference with a source table", () => {
    const source = readySnapshot(packageXml(paragraph("Previous")));
    const proposed = plan(source, [
      {
        id: "table",
        type: "table",
        sourceRef: "b1",
        rows: [{ sourceIndex: 0, cells: [{ sourceIndex: 0 }] }],
      },
    ]);
    expect(() => compileWordDocumentPlan(proposed, source)).toThrow(
      "Unknown source table",
    );
    expect(
      new DOMParser()
        .parseFromString(source.ooxml, "application/xml")
        .getElementsByTagNameNS(W, "tbl"),
    ).toHaveLength(0);
  });
});
