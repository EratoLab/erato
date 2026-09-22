import { describe, expect, it } from "vitest";

import {
  wordAttribute,
  wordChild,
  wordElement,
  WORDPROCESSING_NS as W,
} from "../wordBlockFormatting";
import {
  compileWordTableBlock,
  parseWordTableBlock,
  readWordTableContent,
} from "../wordTableContent";

import type { WordTableBlock } from "../wordTableContent";

interface TextBlock {
  id: string;
  type: "paragraph";
  text: string;
}
const p = (text: string): TextBlock => ({
  id: `p${text.length}`,
  type: "paragraph",
  text,
});
const parseBlock = (v: unknown): TextBlock | null => {
  const b = v as TextBlock;
  return b &&
    typeof b.id === "string" &&
    b.type === "paragraph" &&
    typeof b.text === "string"
    ? b
    : null;
};
const doc = () =>
  new DOMParser().parseFromString(
    `<w:document xmlns:w="${W}"/>`,
    "application/xml",
  );
const compile = (d: Document) => (blocks: TextBlock[]) =>
  blocks.map((b) => {
    const para = wordElement(d, "p");
    const run = wordElement(d, "r");
    const text = wordElement(d, "t");
    text.textContent = b.text;
    run.append(text);
    para.append(run);
    return para;
  });
const raw = (rows: unknown[], extra = {}) => ({
  type: "table",
  id: "table1",
  ...extra,
  rows,
});
const source = () =>
  new DOMParser().parseFromString(
    `
  <w:tbl xmlns:w="${W}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:x="urn:extension" x:id="native-table">
    <w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblCaption w:val="Original"/><x:unknown x:value="keep"/></w:tblPr>
    <w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="3000"/></w:tblGrid>
    <w:tr x:row="zero"><w:trPr><w:cantSplit/></w:trPr>
      <w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/><w:shd w:fill="EEEFFF"/><x:cellProp/></w:tcPr><w:p><w:bookmarkStart w:id="7" w:name="keep"/><w:hyperlink r:id="link1"><w:r><w:t>Link</w:t></w:r></w:hyperlink><w:bookmarkEnd w:id="7"/></w:p></w:tc>
      <w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc>
    </w:tr>
    <w:tr x:row="one"><w:tc><w:p><w:r><w:t>C</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>D</w:t></w:r></w:p></w:tc></w:tr>
  </w:tbl>`,
    "application/xml",
  ).documentElement;
const cells = (table: Element) =>
  Array.from(table.getElementsByTagNameNS(W, "tc"));
const nativePlan = (): WordTableBlock<TextBlock> =>
  parseWordTableBlock(
    raw(
      [
        { sourceIndex: 0, cells: [{ sourceIndex: 0 }, { sourceIndex: 1 }] },
        { sourceIndex: 1, cells: [{ sourceIndex: 0 }, { sourceIndex: 1 }] },
      ],
      { sourceRef: "b4" },
    ),
    parseBlock,
  )!;

describe("typed Word table authoring", () => {
  it("drops source indentation when centering a table and writes consistent row alignment", () => {
    const original = source();
    const ind = wordElement(original.ownerDocument, "tblInd");
    ind.setAttributeNS(W, "w:w", "720");
    ind.setAttributeNS(W, "w:type", "dxa");
    wordChild(original, "tblPr")!.append(ind);
    const plan = nativePlan();
    plan.format = { alignment: "center" };
    const d = doc();
    const table = compileWordTableBlock(d, plan, compile(d), original);
    expect(wordChild(wordChild(table, "tblPr"), "tblInd")).toBeUndefined();
    expect(
      Array.from(table.getElementsByTagNameNS(W, "trPr")).map((row) =>
        wordAttribute(wordChild(row, "jc")),
      ),
    ).toEqual(["center", "center"]);
    plan.format = { alignment: "left", indent: 36 };
    const left = compileWordTableBlock(d, plan, compile(d), original);
    expect(
      wordAttribute(wordChild(wordChild(left, "tblPr"), "tblInd"), "w"),
    ).toBe("720");
  });

  it("rejects incompatible positive indentation and nonleading table alignment", () => {
    for (const alignment of ["center", "right"])
      expect(
        parseWordTableBlock(
          raw([{ cells: [{ blocks: [] }] }], {
            format: { alignment, indent: 20 },
          }),
          parseBlock,
        ),
      ).toBeNull();
    const original = source();
    wordChild(original, "tblPr")!.append(
      wordElement(original.ownerDocument, "jc", "center"),
    );
    const plan = nativePlan();
    plan.format = { indent: 20 };
    const d = doc();
    expect(() => compileWordTableBlock(d, plan, compile(d), original)).toThrow(
      "Table indentation requires left alignment",
    );
  });
  it("creates a native table with readable cells, column widths and repeatable headers", () => {
    const value = parseWordTableBlock(
      raw(
        [
          {
            format: { repeatHeader: true },
            cells: [{ blocks: [p("Name")] }, { blocks: [p("Value")] }],
          },
          { cells: [{ blocks: [p("One")] }, { blocks: [p("Two")] }] },
        ],
        {
          columns: [120, 240],
          format: {
            layout: "fixed",
            width: 360,
            firstRow: true,
            bandedRows: true,
            cellMargins: { top: 4, bottom: 4 },
            borders: {
              bottom: { style: "single", width: 0.5, color: "112233" },
            },
          },
        },
      ),
      parseBlock,
    )!;
    const d = doc();
    const table = compileWordTableBlock(d, value, compile(d));
    const read = readWordTableContent<TextBlock>(table);
    expect(read.columns).toEqual([120, 240]);
    expect(read.rows.map((r) => r.cells.map((c) => c.text))).toEqual([
      ["Name", "Value"],
      ["One", "Two"],
    ]);
    expect(read.rows[0].format.repeatHeader).toBe(true);
    expect(read.format).toMatchObject(value.format!);
    expect(
      wordAttribute(wordChild(wordChild(cells(table)[0], "tcPr"), "tcW"), "w"),
    ).toBe("2400");
  });

  it("retains complete native cell contents and unknown table/row/cell metadata when restyling", () => {
    const original = source();
    const plan = nativePlan();
    plan.format = { caption: "Restyled", shading: "FAFAFA" };
    plan.rows[0].cells[1].format = {
      verticalAlign: "center",
      shading: "112233",
    };
    const d = doc();
    const table = compileWordTableBlock(d, plan, compile(d), original);
    expect(new XMLSerializer().serializeToString(cells(table)[0])).toBe(
      new XMLSerializer().serializeToString(cells(original)[0]),
    );
    expect(table.getAttributeNS("urn:extension", "id")).toBe("native-table");
    expect(
      table.getElementsByTagNameNS("urn:extension", "unknown"),
    ).toHaveLength(1);
    expect(
      table.getElementsByTagNameNS("urn:extension", "cellProp"),
    ).toHaveLength(1);
    expect(readWordTableContent(table).format.caption).toBe("Restyled");
    expect(readWordTableContent(table).rows[0].cells[1].format).toMatchObject({
      verticalAlign: "center",
      shading: "112233",
    });
  });

  it("edits one cell while retaining neighboring native contents", () => {
    const original = source();
    const plan = nativePlan();
    plan.rows[0].cells[1].blocks = [p('New <content> & "text"')];
    const d = doc();
    const table = compileWordTableBlock(d, plan, compile(d), original);
    expect(
      readWordTableContent(table).rows[0].cells.map((c) => c.text),
    ).toEqual(["Link", 'New <content> & "text"']);
    expect(table.getElementsByTagNameNS(W, "bookmarkStart")).toHaveLength(1);
    expect(table.getElementsByTagName("content")).toHaveLength(0);
  });

  it("reorders/deletes rows and columns and inserts new rows/cells", () => {
    const plan = parseWordTableBlock(
      raw(
        [
          {
            sourceIndex: 1,
            cells: [{ sourceIndex: 1 }, { blocks: [p("New")] }],
          },
          { cells: [{ blocks: [p("Extra")] }, { blocks: [] }] },
        ],
        { sourceRef: "b4", columns: [100, 200] },
      ),
      parseBlock,
    )!;
    const d = doc();
    const table = compileWordTableBlock(d, plan, compile(d), source());
    const inventory = readWordTableContent(table);
    expect(inventory.rows.map((r) => r.cells.map((c) => c.text))).toEqual([
      ["D", "New"],
      ["Extra", ""],
    ]);
    expect(table.getElementsByTagNameNS(W, "bookmarkStart")).toHaveLength(0);
    expect(inventory.columns).toEqual([100, 200]);
  });

  it("clears an existing rich cell explicitly and emits a valid empty paragraph", () => {
    const plan = nativePlan();
    plan.rows[0].cells[0].blocks = [];
    const d = doc();
    const table = compileWordTableBlock(d, plan, compile(d), source());
    expect(
      cells(table)[0].getElementsByTagNameNS(W, "bookmarkStart"),
    ).toHaveLength(0);
    expect(cells(table)[0].getElementsByTagNameNS(W, "p")).toHaveLength(1);
    expect(readWordTableContent(table).rows[0].cells[0].text).toBe("");
  });

  it("supports horizontal and vertical merges and reads semantic spans back", () => {
    const plan = parseWordTableBlock(
      raw(
        [
          {
            cells: [
              { colSpan: 2, rowSpan: 2, blocks: [p("Merged")] },
              { blocks: [p("Right top")] },
            ],
          },
          { cells: [{ blocks: [p("Right bottom")] }] },
          {
            cells: [
              { blocks: [p("A")] },
              { blocks: [p("B")] },
              { blocks: [p("C")] },
            ],
          },
        ],
        { columns: [100, 100, 100] },
      ),
      parseBlock,
    )!;
    const d = doc();
    const table = compileWordTableBlock(d, plan, compile(d));
    expect(table.getElementsByTagNameNS(W, "vMerge")).toHaveLength(2);
    const inventory = readWordTableContent(table);
    expect(inventory.rows[0].cells[0]).toMatchObject({
      colSpan: 2,
      rowSpan: 2,
      text: "Merged",
    });
    expect(inventory.rows[1].cells).toHaveLength(1);
    expect(inventory.rows[1].cells[0].text).toBe("Right bottom");
    expect(inventory.sourcePatchSupported).toBe(true);
  });

  it("preserves content and native metadata inside a retained vertical continuation", () => {
    const original = new DOMParser().parseFromString(
      `<w:tbl xmlns:w="${W}" xmlns:x="urn:extension"><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>Top</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc x:hidden="kept"><w:tcPr><w:vMerge/></w:tcPr><w:p><w:r><w:t>Hidden</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`,
      "application/xml",
    ).documentElement;
    const plan = parseWordTableBlock(
      raw(
        [
          { sourceIndex: 0, cells: [{ sourceIndex: 0, rowSpan: 2 }] },
          { sourceIndex: 1, cells: [] },
        ],
        { sourceRef: "b2" },
      ),
      parseBlock,
    )!;
    const d = doc();
    const table = compileWordTableBlock(d, plan, compile(d), original);
    expect(cells(table)[1].getAttributeNS("urn:extension", "hidden")).toBe(
      "kept",
    );
    expect(cells(table)[1].textContent).toBe("Hidden");
  });

  it("allows nested compiled block elements and supplies the terminal cell paragraph", () => {
    const plan = parseWordTableBlock(
      raw([{ cells: [{ blocks: [p("Nested placeholder")] }] }]),
      parseBlock,
    )!;
    const d = doc();
    const table = compileWordTableBlock(d, plan, () => [wordElement(d, "tbl")]);
    expect(
      Array.from(cells(table)[0].children).map((e) => e.localName),
    ).toEqual(["tcPr", "tbl", "p"]);
  });

  it("extracts cell blocks through the host parser without exposing raw XML", () => {
    const inventory = readWordTableContent(source(), (elements) =>
      elements.map((e) => p(e.textContent ?? "")),
    );
    expect(inventory.rows[0].cells[0].blocks?.[0].text).toBe("Link");
    expect(JSON.stringify(inventory)).not.toContain("<w:");
    expect(inventory.rows[0].cells[0].sourceIndex).toBe(0);
  });

  it.each([
    raw([]),
    raw([{ cells: [] }]),
    raw([{ cells: [{}] }]),
    raw([{ cells: [{ blocks: [], rowSpan: 2 }] }]),
    raw([
      { cells: [{ blocks: [] }, { blocks: [] }] },
      { cells: [{ blocks: [] }] },
    ]),
    raw([{ cells: [{ blocks: [], colSpan: 0 }] }]),
    raw([{ cells: [{ blocks: [], colSpan: 64 }] }]),
    raw([{ cells: [{ blocks: [] }] }], { columns: [100, 100] }),
    raw([{ cells: [{ blocks: [] }] }], { columns: [NaN] }),
    raw([{ cells: [{ sourceIndex: 0 }] }], { sourceRef: "b1" }),
    raw([{ sourceIndex: 0, cells: [{ sourceIndex: 0 }, { sourceIndex: 0 }] }], {
      sourceRef: "b1",
    }),
    raw(
      [
        { sourceIndex: 0, cells: [{ sourceIndex: 0 }] },
        { sourceIndex: 0, cells: [{ sourceIndex: 0 }] },
      ],
      { sourceRef: "b1" },
    ),
    raw([{ cells: [{ blocks: [{ type: "raw-xml", text: "<w:p/>" }] }] }]),
    raw([{ cells: [{ blocks: [], format: { xml: "raw" } }] }]),
    raw([{ cells: [{ blocks: [] }] }], {
      format: { width: 100, widthPercent: 100 },
    }),
  ])("rejects invalid, ambiguous, or untyped table plans %#", (value) => {
    expect(parseWordTableBlock(value, parseBlock)).toBeNull();
  });

  it("rejects overlapping row spans", () => {
    expect(
      parseWordTableBlock(
        raw([
          {
            cells: [{ blocks: [] }, { rowSpan: 2, blocks: [] }, { blocks: [] }],
          },
          { cells: [{ colSpan: 2, blocks: [] }] },
        ]),
        parseBlock,
      ),
    ).toBeNull();
  });

  it("rejects unknown source references before compiling cell contents", () => {
    const plan = nativePlan();
    plan.rows[0].sourceIndex = 99;
    const d = doc();
    expect(() => compileWordTableBlock(d, plan, compile(d), source())).toThrow(
      "Unknown or repeated source row",
    );
    expect(() => compileWordTableBlock(d, nativePlan(), compile(d))).toThrow(
      "Unknown source table",
    );
  });

  it("makes wrapper limitations explicit while allowing replacement from a fresh typed table", () => {
    const original = source();
    const control = wordElement(original.ownerDocument, "sdt");
    control.append(wordElement(original.ownerDocument, "sdtContent"));
    original.append(control);
    expect(readWordTableContent(original).sourcePatchSupported).toBe(false);
    const d = doc();
    expect(() =>
      compileWordTableBlock(d, nativePlan(), compile(d), original),
    ).toThrow("explicit replacement");
    const replacement = parseWordTableBlock(
      raw([{ cells: [{ blocks: [p("Replacement")] }] }]),
      parseBlock,
    )!;
    expect(
      compileWordTableBlock(d, replacement, compile(d)).textContent,
    ).toContain("Replacement");
  });
});
