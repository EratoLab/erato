import {
  applyWordBorders,
  applyWordShading,
  parseWordBorders,
  putWordProperty,
  readWordBorders,
  setWordAttribute,
  wordAttribute,
  wordChild,
  wordElement,
  WORDPROCESSING_NS,
} from "./wordBlockFormatting";
import { wordPlanError } from "./wordPlanDiagnostics";

import type { WordBorders } from "./wordBlockFormatting";
import type { WordPlanDiagnostics } from "./wordPlanDiagnostics";

export interface WordCellMargins {
  top?: number;
  left?: number;
  bottom?: number;
  right?: number;
}
export interface WordTableFormatting {
  styleRef?: string;
  alignment?: "left" | "center" | "right";
  layout?: "fixed" | "autofit";
  width?: number | "auto";
  widthPercent?: number;
  indent?: number;
  cellMargins?: WordCellMargins;
  borders?: WordBorders;
  shading?: string;
  firstRow?: boolean;
  lastRow?: boolean;
  firstColumn?: boolean;
  lastColumn?: boolean;
  bandedRows?: boolean;
  bandedColumns?: boolean;
  caption?: string;
  description?: string;
}
export interface WordTableRowFormatting {
  repeatHeader?: boolean;
  allowSplit?: boolean;
  height?: number;
  heightRule?: "atLeast" | "exact";
}
export interface WordTableCellFormatting {
  verticalAlign?: "top" | "center" | "bottom";
  textDirection?: "horizontal" | "vertical" | "vertical270";
  margins?: WordCellMargins;
  borders?: WordBorders;
  shading?: string;
  noWrap?: boolean;
}
export interface WordTableCell<T> {
  /** Zero-based physical cell index in the selected source row. */
  sourceIndex?: number;
  colSpan?: number;
  /** Subsequent rows omit the slots covered by this cell. */
  rowSpan?: number;
  format?: WordTableCellFormatting;
  /** Omit to retain a source cell's complete native contents. [] clears it. */
  blocks?: T[];
}
export interface WordTableRow<T> {
  /** Zero-based row index; source rows and cells can be reordered or omitted. */
  sourceIndex?: number;
  format?: WordTableRowFormatting;
  cells: WordTableCell<T>[];
}
export interface WordTableBlock<T> {
  type: "table";
  id: string;
  text: string;
  sourceRef?: string;
  columns?: number[];
  format?: WordTableFormatting;
  rows: WordTableRow<T>[];
}
export interface WordTableContent<T> {
  columns: number[];
  format: WordTableFormatting;
  rows: {
    sourceIndex: number;
    format: WordTableRowFormatting;
    cells: (WordTableCell<T> & { sourceIndex: number; text: string })[];
  }[];
  sourcePatchSupported: boolean;
}

const MAX_ROWS = 1000;
const MAX_COLUMNS = 63;
const MAX_CELLS = 8000;
const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const only = (v: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(v).every((key) => allowed.includes(key));
const identifier = (v: unknown): v is string =>
  typeof v === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(v);
const finite = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const index = (v: unknown, max: number) =>
  finite(v, 0, max) && Number.isInteger(v);
const literal = (v: unknown, values: string[]) =>
  typeof v === "string" && values.includes(v);
const safeText = (v: unknown, max = 2000): v is string =>
  typeof v === "string" &&
  v.length <= max &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v);
const color = (v: unknown): v is string =>
  typeof v === "string" && /^(?:auto|#?[a-fA-F0-9]{6})$/.test(v);
const normalizeColor = (v: string) =>
  v === "auto" ? v : v.replace(/^#/, "").toUpperCase();
const children = (parent: Element, name: string) =>
  Array.from(parent.children).filter(
    (e) => e.namespaceURI === WORDPROCESSING_NS && e.localName === name,
  );

function parseMargins(v: unknown): WordCellMargins | null {
  return object(v) &&
    only(v, ["top", "left", "bottom", "right"]) &&
    Object.values(v).every((n) => finite(n, 0, 1584))
    ? v
    : null;
}
export function parseWordTableFormatting(
  value: unknown,
): WordTableFormatting | null {
  const bools = [
    "firstRow",
    "lastRow",
    "firstColumn",
    "lastColumn",
    "bandedRows",
    "bandedColumns",
  ];
  if (
    !object(value) ||
    !only(value, [
      ...bools,
      "styleRef",
      "alignment",
      "layout",
      "width",
      "widthPercent",
      "indent",
      "cellMargins",
      "borders",
      "shading",
      "caption",
      "description",
    ]) ||
    bools.some(
      (key) => value[key] !== undefined && typeof value[key] !== "boolean",
    ) ||
    (value.styleRef !== undefined &&
      (!safeText(value.styleRef, 200) || !value.styleRef)) ||
    (value.alignment !== undefined &&
      !literal(value.alignment, ["left", "center", "right"])) ||
    (value.layout !== undefined &&
      !literal(value.layout, ["fixed", "autofit"])) ||
    (value.width !== undefined &&
      value.width !== "auto" &&
      !finite(value.width, 1, 3168)) ||
    (value.widthPercent !== undefined &&
      (!finite(value.widthPercent, 0.1, 100) || value.width !== undefined)) ||
    (value.indent !== undefined && !finite(value.indent, 0, 1584)) ||
    (typeof value.indent === "number" &&
      value.indent > 0 &&
      value.alignment !== undefined &&
      value.alignment !== "left") ||
    (value.shading !== undefined && !color(value.shading)) ||
    [value.caption, value.description].some(
      (v) => v !== undefined && !safeText(v),
    )
  )
    return null;
  const borders =
    value.borders === undefined ? undefined : parseWordBorders(value.borders);
  const margins =
    value.cellMargins === undefined
      ? undefined
      : parseMargins(value.cellMargins);
  if (borders === null || margins === null || borders?.between) return null;
  return {
    ...(value as WordTableFormatting),
    ...(borders ? { borders } : {}),
    ...(margins ? { cellMargins: margins } : {}),
    ...(value.shading ? { shading: normalizeColor(value.shading) } : {}),
  };
}
export function parseWordTableRowFormatting(
  value: unknown,
): WordTableRowFormatting | null {
  if (
    !object(value) ||
    !only(value, ["repeatHeader", "allowSplit", "height", "heightRule"]) ||
    [value.repeatHeader, value.allowSplit].some(
      (v) => v !== undefined && typeof v !== "boolean",
    ) ||
    (value.height !== undefined && !finite(value.height, 0, 1584)) ||
    (value.heightRule !== undefined &&
      (value.height === undefined ||
        !literal(value.heightRule, ["atLeast", "exact"])))
  )
    return null;
  return value;
}
export function parseWordTableCellFormatting(
  value: unknown,
): WordTableCellFormatting | null {
  if (
    !object(value) ||
    !only(value, [
      "verticalAlign",
      "textDirection",
      "margins",
      "borders",
      "shading",
      "noWrap",
    ]) ||
    (value.verticalAlign !== undefined &&
      !literal(value.verticalAlign, ["top", "center", "bottom"])) ||
    (value.textDirection !== undefined &&
      !literal(value.textDirection, [
        "horizontal",
        "vertical",
        "vertical270",
      ])) ||
    (value.shading !== undefined && !color(value.shading)) ||
    (value.noWrap !== undefined && typeof value.noWrap !== "boolean")
  )
    return null;
  const margins =
    value.margins === undefined ? undefined : parseMargins(value.margins);
  const borders =
    value.borders === undefined ? undefined : parseWordBorders(value.borders);
  if (margins === null || borders === null || borders?.between) return null;
  return {
    ...(value as WordTableCellFormatting),
    ...(margins ? { margins } : {}),
    ...(borders ? { borders } : {}),
    ...(value.shading ? { shading: normalizeColor(value.shading) } : {}),
  };
}

interface PlacedCell<T> {
  cell: WordTableCell<T>;
  row: number;
  column: number;
  continuation: boolean;
  originRow: number;
}

function tableGrid<T>(
  rows: WordTableRow<T>[],
  columns?: number[],
): PlacedCell<T>[][] | null {
  const grid: (PlacedCell<T> | undefined)[][] = rows.map(() => []);
  let width = columns?.length ?? 0;
  for (let row = 0; row < rows.length; row++) {
    let cursor = 0;
    for (const cell of rows[row].cells) {
      while (grid[row][cursor]) cursor++;
      const colSpan = cell.colSpan ?? 1;
      const rowSpan = cell.rowSpan ?? 1;
      if (cursor + colSpan > MAX_COLUMNS || row + rowSpan > rows.length)
        return null;
      for (let y = row; y < row + rowSpan; y++) {
        const placed = {
          cell,
          row: y,
          column: cursor,
          continuation: y !== row,
          originRow: row,
        };
        for (let x = cursor; x < cursor + colSpan; x++) {
          if (grid[y][x]) return null;
          grid[y][x] = placed;
        }
      }
      cursor += colSpan;
    }
    if (!width) width = grid[row].length;
    if (
      !width ||
      grid[row].length !== width ||
      Array.from({ length: width }, (_, i) => grid[row][i]).some((c) => !c)
    )
      return null;
  }
  return grid.map(
    (row) =>
      row.filter((entry, i) => entry && entry.column === i) as PlacedCell<T>[],
  );
}

export function parseWordTableBlock<T extends { text: string }>(
  value: unknown,
  parseBlock: (value: unknown, path?: string) => T | null,
  issues?: WordPlanDiagnostics,
  path = "",
): WordTableBlock<T> | null {
  const fail = (at: string, code: string, message: string) =>
    wordPlanError(issues, at, code, message);
  if (
    !object(value) ||
    !only(value, [
      "type",
      "id",
      "text",
      "sourceRef",
      "columns",
      "format",
      "rows",
    ]) ||
    value.type !== "table" ||
    !identifier(value.id) ||
    (value.text !== undefined && !safeText(value.text, 256 * 1024)) ||
    (value.sourceRef !== undefined && !identifier(value.sourceRef)) ||
    (value.columns !== undefined &&
      (!Array.isArray(value.columns) ||
        value.columns.length === 0 ||
        value.columns.length > MAX_COLUMNS ||
        !value.columns.every((w) => finite(w, 1, 3168)) ||
        value.columns.reduce((total: number, w: number) => total + w, 0) >
          3168)) ||
    !Array.isArray(value.rows) ||
    value.rows.length === 0 ||
    value.rows.length > MAX_ROWS
  )
    return fail(
      path,
      "table-shape",
      "Invalid table fields, columns or rows; use the table contract and limits.",
    );
  const format =
    value.format === undefined
      ? undefined
      : parseWordTableFormatting(value.format);
  if (format === null)
    return fail(
      `${path}/format`,
      "table-format",
      "Invalid table formatting; width is a positive number or auto, and cannot be combined with widthPercent.",
    );
  const rows: WordTableRow<T>[] = [];
  let cellsCount = 0;
  const sourceRows = new Set<number>();
  for (const [rowIndex, row] of value.rows.entries()) {
    const rowPath = `${path}/rows/${rowIndex}`;
    if (
      !object(row) ||
      !only(row, ["sourceIndex", "format", "cells"]) ||
      (row.sourceIndex !== undefined &&
        (!value.sourceRef ||
          !index(row.sourceIndex, MAX_ROWS - 1) ||
          sourceRows.has(row.sourceIndex as number))) ||
      !Array.isArray(row.cells) ||
      row.cells.length > MAX_COLUMNS
    )
      return fail(
        rowPath,
        "table-row",
        "Invalid row: sourceIndex requires table.sourceRef and a unique original row index; cells must be an array.",
      );
    if (row.sourceIndex !== undefined)
      sourceRows.add(row.sourceIndex as number);
    const rowFormat =
      row.format === undefined
        ? undefined
        : parseWordTableRowFormatting(row.format);
    if (rowFormat === null)
      return fail(
        `${rowPath}/format`,
        "row-format",
        "Unsupported row formatting; use repeatHeader, allowSplit, height and heightRule.",
      );
    const cells: WordTableCell<T>[] = [];
    const sourceCells = new Set<number>();
    for (const [cellIndex, cell] of row.cells.entries()) {
      const cellPath = `${rowPath}/cells/${cellIndex}`;
      if (
        !object(cell) ||
        !only(cell, [
          "sourceIndex",
          "colSpan",
          "rowSpan",
          "format",
          "blocks",
        ]) ||
        (cell.sourceIndex !== undefined &&
          (row.sourceIndex === undefined ||
            !index(cell.sourceIndex, MAX_COLUMNS - 1) ||
            sourceCells.has(cell.sourceIndex as number))) ||
        (cell.colSpan !== undefined &&
          (!index(cell.colSpan, MAX_COLUMNS) || cell.colSpan === 0)) ||
        (cell.rowSpan !== undefined &&
          (!index(cell.rowSpan, MAX_ROWS) || cell.rowSpan === 0)) ||
        (cell.blocks === undefined && cell.sourceIndex === undefined) ||
        (cell.blocks !== undefined &&
          (!Array.isArray(cell.blocks) || cell.blocks.length > 2000))
      )
        return fail(
          cellPath,
          "table-cell",
          "Invalid cell: sourceIndex requires a source row and unique original cell index; new cells require blocks (empty array clears). Spans must be positive integers within table limits.",
        );
      if (++cellsCount > MAX_CELLS)
        return fail(
          path,
          "table-size",
          "A table cannot contain more than 8000 cells.",
        );
      if (cell.sourceIndex !== undefined)
        sourceCells.add(cell.sourceIndex as number);
      const cellFormat =
        cell.format === undefined
          ? undefined
          : parseWordTableCellFormatting(cell.format);
      if (cellFormat === null)
        return fail(
          `${cellPath}/format`,
          "cell-format",
          "Unsupported cell formatting; use the cell format contract.",
        );
      const blocks =
        cell.blocks === undefined
          ? undefined
          : (cell.blocks as unknown[]).map((block, i) =>
              parseBlock(block, `${cellPath}/blocks/${i}`),
            );
      if (blocks?.some((block) => block === null)) return null;
      cells.push({
        ...(cell.sourceIndex === undefined
          ? {}
          : { sourceIndex: cell.sourceIndex as number }),
        ...(cell.colSpan === undefined
          ? {}
          : { colSpan: cell.colSpan as number }),
        ...(cell.rowSpan === undefined
          ? {}
          : { rowSpan: cell.rowSpan as number }),
        ...(cellFormat ? { format: cellFormat } : {}),
        ...(blocks ? { blocks: blocks as T[] } : {}),
      });
    }
    rows.push({
      ...(row.sourceIndex === undefined
        ? {}
        : { sourceIndex: row.sourceIndex as number }),
      ...(rowFormat ? { format: rowFormat } : {}),
      cells,
    });
  }
  if (!tableGrid(rows, value.columns))
    return fail(
      `${path}/rows`,
      "table-grid",
      "Rows and column widths must form one complete rectangular grid without overlapping spans or missing cells.",
    );
  return {
    type: "table",
    id: value.id,
    text: rows
      .map((row) =>
        row.cells
          .map((cell) => cell.blocks?.map((b) => b.text).join("\n") ?? "")
          .join("\t"),
      )
      .join("\n"),
    ...(value.sourceRef ? { sourceRef: value.sourceRef } : {}),
    ...(value.columns ? { columns: value.columns } : {}),
    ...(format ? { format } : {}),
    rows,
  };
}

const property = (parent: Element, tag: string) =>
  (wordChild(parent, tag)?.cloneNode(true) as Element | undefined) ??
  wordElement(parent.ownerDocument, tag);
function applyMargins(
  parent: Element,
  tag: string,
  margins: WordCellMargins,
): void {
  const result = property(parent, tag);
  for (const [side, width] of Object.entries(margins)) {
    const e = wordElement(parent.ownerDocument, side);
    setWordAttribute(e, "type", "dxa");
    setWordAttribute(e, "w", Math.round(width * 20));
    putWordProperty(result, e);
  }
  putWordProperty(parent, result);
}
function applyTableFormat(props: Element, format: WordTableFormatting): void {
  const doc = props.ownerDocument;
  if (format.styleRef !== undefined)
    putWordProperty(props, wordElement(doc, "tblStyle", format.styleRef));
  if (format.alignment !== undefined)
    putWordProperty(props, wordElement(doc, "jc", format.alignment));
  if (format.layout !== undefined) {
    const layout = wordElement(doc, "tblLayout");
    setWordAttribute(layout, "type", format.layout);
    putWordProperty(props, layout);
  }
  if (format.width !== undefined || format.widthPercent !== undefined) {
    const width = wordElement(doc, "tblW");
    setWordAttribute(
      width,
      "type",
      format.widthPercent !== undefined
        ? "pct"
        : format.width === "auto"
          ? "auto"
          : "dxa",
    );
    setWordAttribute(
      width,
      "w",
      format.widthPercent !== undefined
        ? Math.round(format.widthPercent * 50)
        : format.width === "auto"
          ? 0
          : Math.round(Number(format.width) * 20),
    );
    putWordProperty(props, width);
  }
  if (format.indent !== undefined) {
    const ind = wordElement(doc, "tblInd");
    setWordAttribute(ind, "type", "dxa");
    setWordAttribute(ind, "w", Math.round(format.indent * 20));
    putWordProperty(props, ind);
  }
  if (format.cellMargins) applyMargins(props, "tblCellMar", format.cellMargins);
  if (format.borders) applyWordBorders(props, "tblBorders", format.borders);
  if (format.shading !== undefined) applyWordShading(props, format.shading);
  const lookFlags = {
    firstRow: ["firstRow", 0x20],
    lastRow: ["lastRow", 0x40],
    firstColumn: ["firstColumn", 0x80],
    lastColumn: ["lastColumn", 0x100],
    bandedRows: ["noHBand", 0x200],
    bandedColumns: ["noVBand", 0x400],
  } as const;
  if (
    Object.keys(lookFlags).some(
      (key) => format[key as keyof typeof lookFlags] !== undefined,
    )
  ) {
    const look = property(props, "tblLook");
    let mask = parseInt(wordAttribute(look), 16) || 0;
    for (const [name, [attribute, bit]] of Object.entries(lookFlags)) {
      const flag = format[name as keyof typeof lookFlags];
      if (flag === undefined) continue;
      const enabled = attribute.startsWith("no") ? !flag : flag;
      setWordAttribute(look, attribute, enabled ? "1" : "0");
      mask = enabled ? mask | bit : mask & ~bit;
    }
    setWordAttribute(
      look,
      "val",
      mask.toString(16).padStart(4, "0").toUpperCase(),
    );
    putWordProperty(props, look);
  }
  if (format.caption !== undefined)
    putWordProperty(props, wordElement(doc, "tblCaption", format.caption));
  if (format.description !== undefined)
    putWordProperty(
      props,
      wordElement(doc, "tblDescription", format.description),
    );
}
function applyRowFormat(props: Element, format: WordTableRowFormatting): void {
  const doc = props.ownerDocument;
  if (format.repeatHeader !== undefined)
    putWordProperty(
      props,
      wordElement(doc, "tblHeader", format.repeatHeader ? "1" : "0"),
    );
  if (format.allowSplit !== undefined)
    putWordProperty(
      props,
      wordElement(doc, "cantSplit", format.allowSplit ? "0" : "1"),
    );
  if (format.height !== undefined) {
    const height = wordElement(
      doc,
      "trHeight",
      String(Math.round(format.height * 20)),
    );
    setWordAttribute(height, "hRule", format.heightRule ?? "atLeast");
    putWordProperty(props, height);
  }
}
function applyCellFormat(
  props: Element,
  format: WordTableCellFormatting,
): void {
  const doc = props.ownerDocument;
  if (format.verticalAlign !== undefined)
    putWordProperty(props, wordElement(doc, "vAlign", format.verticalAlign));
  if (format.textDirection !== undefined)
    putWordProperty(
      props,
      wordElement(
        doc,
        "textDirection",
        { horizontal: "lrTb", vertical: "tbRl", vertical270: "btLr" }[
          format.textDirection
        ],
      ),
    );
  if (format.margins) applyMargins(props, "tcMar", format.margins);
  if (format.borders) applyWordBorders(props, "tcBorders", format.borders);
  if (format.shading !== undefined) applyWordShading(props, format.shading);
  if (format.noWrap !== undefined)
    putWordProperty(
      props,
      wordElement(doc, "noWrap", format.noWrap ? "1" : "0"),
    );
}

function cellText(cell: Element): string {
  const visit = (element: Element): string => {
    if (element.namespaceURI === WORDPROCESSING_NS) {
      if (element.localName === "t") return element.textContent ?? "";
      if (element.localName === "tab") return "\t";
      if (["br", "cr"].includes(element.localName)) return "\n";
    }
    return Array.from(element.children).map(visit).join("");
  };
  return Array.from(cell.children)
    .filter(
      (e) => !(e.namespaceURI === WORDPROCESSING_NS && e.localName === "tcPr"),
    )
    .map(visit)
    .join("\n");
}
function sourcePatchSupported(table: Element): boolean {
  return (
    Array.from(table.children).every(
      (e) =>
        e.namespaceURI === WORDPROCESSING_NS &&
        ["tblPr", "tblGrid", "tr"].includes(e.localName),
    ) &&
    children(table, "tr").every(
      (row) =>
        Array.from(row.children).every(
          (e) =>
            e.namespaceURI === WORDPROCESSING_NS &&
            ["tblPrEx", "trPr", "tc"].includes(e.localName),
        ) &&
        !wordChild(wordChild(row, "trPr"), "gridBefore") &&
        !wordChild(wordChild(row, "trPr"), "gridAfter") &&
        children(row, "tc").every(
          (cell) => !wordChild(wordChild(cell, "tcPr"), "hMerge"),
        ),
    )
  );
}

function tableAlignment(doc: Document, props: Element): string {
  const direct = wordAttribute(wordChild(props, "jc"));
  if (direct) return direct;
  const styles = Array.from(
    doc.getElementsByTagNameNS(WORDPROCESSING_NS, "style"),
  ).filter((style) => wordAttribute(style, "type") === "table");
  let styleId =
    wordAttribute(wordChild(props, "tblStyle")) ||
    wordAttribute(
      styles.find((style) =>
        ["1", "true", "on"].includes(wordAttribute(style, "default")),
      ),
      "styleId",
    );
  const seen = new Set<string>();
  while (styleId && !seen.has(styleId)) {
    seen.add(styleId);
    const style = styles.find(
      (item) => wordAttribute(item, "styleId") === styleId,
    );
    const alignment = wordAttribute(wordChild(wordChild(style, "tblPr"), "jc"));
    if (alignment) return alignment;
    styleId = wordAttribute(wordChild(style, "basedOn"));
  }
  return "left";
}

export function compileWordTableBlock<T>(
  doc: Document,
  block: WordTableBlock<T>,
  compileBlocks: (blocks: T[]) => Element[],
  sourceTable?: Element,
): Element {
  const grid = tableGrid(block.rows, block.columns);
  if (!grid) throw new Error("Invalid table grid");
  if (block.sourceRef && !sourceTable) throw new Error("Unknown source table");
  if (sourceTable && !sourcePatchSupported(sourceTable))
    throw new Error("Source table wrappers require explicit replacement");
  const sources = sourceTable ? children(sourceTable, "tr") : [];
  const table = sourceTable
    ? doc.importNode(sourceTable, false)
    : wordElement(doc, "tbl");
  const sourceProps = sourceTable && wordChild(sourceTable, "tblPr");
  const props = sourceProps
    ? doc.importNode(sourceProps, true)
    : wordElement(doc, "tblPr");
  if (!sourceProps)
    applyTableFormat(props, {
      firstRow: true,
      lastRow: false,
      firstColumn: true,
      lastColumn: false,
      bandedRows: true,
      bandedColumns: false,
    });
  if (block.format) applyTableFormat(props, block.format);
  if (block.columns) {
    if (
      block.format?.width === undefined &&
      block.format?.widthPercent === undefined
    )
      applyTableFormat(props, {
        width:
          block.columns.reduce(
            (sum, value) => sum + Math.round(value * 20),
            0,
          ) / 20,
      });
    if (block.format?.layout === undefined)
      applyTableFormat(props, { layout: "fixed" });
  } else if (!sourceProps && !wordChild(props, "tblW"))
    applyTableFormat(props, { widthPercent: 100 });
  const alignment = tableAlignment(doc, props);
  table.append(props);
  const width = grid[0].reduce((sum, c) => sum + (c.cell.colSpan ?? 1), 0);
  const originalColumns = sourceTable && wordChild(sourceTable, "tblGrid");
  const sourceWidths = originalColumns
    ? children(originalColumns, "gridCol").map(
        (e) => Number(wordAttribute(e, "w")) / 20,
      )
    : [];
  const widths =
    block.columns ??
    (sourceWidths.length === width && sourceWidths.every((n) => n > 0)
      ? sourceWidths
      : Array.from({ length: width }, () => 468 / width));
  const preserveGrid =
    originalColumns && !block.columns && sourceWidths.length === width;
  const tblGrid = preserveGrid
    ? doc.importNode(originalColumns, true)
    : wordElement(doc, "tblGrid");
  if (!preserveGrid)
    widths.forEach((n) => {
      const col = wordElement(doc, "gridCol");
      setWordAttribute(col, "w", Math.round(n * 20));
      tblGrid.append(col);
    });
  table.append(tblGrid);
  const usedRows = new Set<number>();
  let nonLeadingRow = false;
  for (let rowIndex = 0; rowIndex < block.rows.length; rowIndex++) {
    const row = block.rows[rowIndex];
    const original =
      row.sourceIndex === undefined ? undefined : sources[row.sourceIndex];
    if (
      row.sourceIndex !== undefined &&
      (!original || usedRows.has(row.sourceIndex))
    )
      throw new Error("Unknown or repeated source row");
    if (row.sourceIndex !== undefined) usedRows.add(row.sourceIndex);
    const tr = original
      ? doc.importNode(original, false)
      : wordElement(doc, "tr");
    const tblPrEx = original && wordChild(original, "tblPrEx");
    if (tblPrEx) tr.append(doc.importNode(tblPrEx, true));
    const originalRowProps = original && wordChild(original, "trPr");
    const rowProps = originalRowProps
      ? doc.importNode(originalRowProps, true)
      : wordElement(doc, "trPr");
    if (row.format) applyRowFormat(rowProps, row.format);
    const rowAlignment =
      block.format?.alignment ??
      (wordAttribute(wordChild(rowProps, "jc")) ||
        wordAttribute(wordChild(tblPrEx, "jc")) ||
        alignment);
    if (rowAlignment !== "left") nonLeadingRow = true;
    // Word copies centered/right table alignment onto each row; materialize it before import.
    if (
      block.format?.alignment !== undefined ||
      (!wordChild(rowProps, "jc") && ["center", "right"].includes(rowAlignment))
    ) {
      putWordProperty(rowProps, wordElement(doc, "jc", rowAlignment));
    }
    if (rowProps.children.length) tr.append(rowProps);
    const usedCells = new Set<number>();
    for (const placed of grid[rowIndex]) {
      const { cell, continuation, column, originRow } = placed;
      const sourceRowIndex = block.rows[originRow].sourceIndex;
      const sourceRow =
        sourceRowIndex === undefined ? undefined : sources[sourceRowIndex];
      const sourceCell =
        cell.sourceIndex === undefined || !sourceRow
          ? undefined
          : children(sourceRow, "tc")[cell.sourceIndex];
      if (
        cell.sourceIndex !== undefined &&
        (!sourceCell || (!continuation && usedCells.has(cell.sourceIndex)))
      )
        throw new Error("Unknown or repeated source cell");
      if (!continuation && cell.sourceIndex !== undefined)
        usedCells.add(cell.sourceIndex);
      // Keep content hidden in a native merge continuation as well as its properties.
      let originalCell = sourceCell;
      if (
        continuation &&
        sourceCell &&
        sourceRow &&
        sourceRowIndex !== undefined
      ) {
        const sourceColumn = children(sourceRow, "tc")
          .slice(0, cell.sourceIndex)
          .reduce(
            (n, c) =>
              n +
              (Number(
                wordAttribute(wordChild(wordChild(c, "tcPr"), "gridSpan")),
              ) || 1),
            0,
          );
        const nextSource = sources[sourceRowIndex + rowIndex - originRow];
        let cursor = 0;
        originalCell =
          nextSource &&
          children(nextSource, "tc").find((c) => {
            const start = cursor;
            cursor +=
              Number(
                wordAttribute(wordChild(wordChild(c, "tcPr"), "gridSpan")),
              ) || 1;
            return (
              start === sourceColumn &&
              !!wordChild(wordChild(c, "tcPr"), "vMerge")
            );
          });
      }
      const tc = originalCell
        ? doc.importNode(originalCell, true)
        : wordElement(doc, "tc");
      const cellProps = wordChild(tc, "tcPr") ?? wordElement(doc, "tcPr");
      if (!cellProps.parentElement) tc.prepend(cellProps);
      const originalSpan =
        Number(wordAttribute(wordChild(cellProps, "gridSpan"))) || 1;
      ["gridSpan", "vMerge", "hMerge"].forEach((name) =>
        wordChild(cellProps, name)?.remove(),
      );
      if ((cell.colSpan ?? 1) > 1)
        putWordProperty(
          cellProps,
          wordElement(doc, "gridSpan", String(cell.colSpan)),
        );
      if ((cell.rowSpan ?? 1) > 1)
        putWordProperty(
          cellProps,
          wordElement(doc, "vMerge", continuation ? "continue" : "restart"),
        );
      if (
        block.columns ||
        !originalCell ||
        originalSpan !== (cell.colSpan ?? 1) ||
        sourceWidths.length !== width
      ) {
        const cellWidth = wordElement(doc, "tcW");
        setWordAttribute(cellWidth, "type", "dxa");
        setWordAttribute(
          cellWidth,
          "w",
          Math.round(
            widths
              .slice(column, column + (cell.colSpan ?? 1))
              .reduce((sum, n) => sum + n, 0) * 20,
          ),
        );
        putWordProperty(cellProps, cellWidth);
      }
      if (cell.format) applyCellFormat(cellProps, cell.format);
      if (!continuation && cell.blocks !== undefined) {
        Array.from(tc.children)
          .filter((e) => e !== cellProps)
          .forEach((e) => e.remove());
        compileBlocks(cell.blocks).forEach((e) =>
          tc.append(e.ownerDocument === doc ? e : doc.importNode(e, true)),
        );
      } else if (!originalCell) {
        if (!continuation && cell.blocks === undefined)
          throw new Error("New table cells require contents");
        tc.append(wordElement(doc, "p"));
      }
      const content = Array.from(tc.children).filter((e) => e !== cellProps);
      if (!content.length || content[content.length - 1].localName !== "p")
        tc.append(wordElement(doc, "p"));
      tr.append(tc);
    }
    table.append(tr);
  }
  // Word discards tblInd if any row is not left-aligned (ISO 29500); omit the ineffective indent.
  if (nonLeadingRow) {
    if ((block.format?.indent ?? 0) > 0)
      throw new Error("Table indentation requires left alignment");
    wordChild(props, "tblInd")?.remove();
  }
  return table;
}

const num = (
  parent: Element | undefined,
  name: string,
  divisor = 1,
): number | undefined => {
  const value = wordAttribute(parent, name);
  const n = Number(value);
  return value && Number.isFinite(n) ? n / divisor : undefined;
};
const enabled = (e: Element) =>
  !["0", "false", "off"].includes(wordAttribute(e));
function readMargins(parent: Element | undefined): WordCellMargins | undefined {
  if (!parent) return undefined;
  const result: WordCellMargins = {};
  for (const side of ["top", "left", "bottom", "right"] as const) {
    const e = wordChild(parent, side);
    const n = num(e, "w", 20);
    if (n !== undefined && wordAttribute(e, "type") === "dxa") result[side] = n;
  }
  return Object.keys(result).length ? result : undefined;
}
function readTableFormat(props: Element | undefined): WordTableFormatting {
  if (!props) return {};
  const format: WordTableFormatting = {};
  const style = wordAttribute(wordChild(props, "tblStyle"));
  if (style) format.styleRef = style;
  const alignment = wordAttribute(wordChild(props, "jc"));
  if (["left", "center", "right"].includes(alignment))
    format.alignment = alignment as WordTableFormatting["alignment"];
  const layout = wordAttribute(wordChild(props, "tblLayout"), "type");
  if (["fixed", "autofit"].includes(layout))
    format.layout = layout as WordTableFormatting["layout"];
  const width = wordChild(props, "tblW");
  const unit = wordAttribute(width, "type");
  const n = num(width, "w");
  if (unit === "auto") format.width = "auto";
  else if (n !== undefined && unit === "dxa") format.width = n / 20;
  else if (n !== undefined && unit === "pct") format.widthPercent = n / 50;
  const indent = wordChild(props, "tblInd");
  const ind = num(indent, "w", 20);
  if (ind !== undefined && wordAttribute(indent, "type") === "dxa")
    format.indent = ind;
  const margins = readMargins(wordChild(props, "tblCellMar"));
  if (margins) format.cellMargins = margins;
  const borders = readWordBorders(wordChild(props, "tblBorders"));
  if (borders) format.borders = borders;
  const shading = wordAttribute(wordChild(props, "shd"), "fill");
  if (color(shading)) format.shading = normalizeColor(shading);
  const look = wordChild(props, "tblLook");
  if (look) {
    const mask = parseInt(wordAttribute(look), 16) || 0;
    for (const [name, [attribute, bit]] of Object.entries({
      firstRow: ["firstRow", 0x20],
      lastRow: ["lastRow", 0x40],
      firstColumn: ["firstColumn", 0x80],
      lastColumn: ["lastColumn", 0x100],
      bandedRows: ["noHBand", 0x200],
      bandedColumns: ["noVBand", 0x400],
    } as const)) {
      const raw = wordAttribute(look, attribute);
      const value = raw ? !["0", "false", "off"].includes(raw) : !!(mask & bit);
      format[
        name as
          | "firstRow"
          | "lastRow"
          | "firstColumn"
          | "lastColumn"
          | "bandedRows"
          | "bandedColumns"
      ] = attribute.startsWith("no") ? !value : value;
    }
  }
  const caption = wordChild(props, "tblCaption");
  if (caption) format.caption = wordAttribute(caption);
  const description = wordChild(props, "tblDescription");
  if (description) format.description = wordAttribute(description);
  return format;
}
function readRowFormat(props: Element | undefined): WordTableRowFormatting {
  if (!props) return {};
  const format: WordTableRowFormatting = {};
  const header = wordChild(props, "tblHeader");
  if (header) format.repeatHeader = enabled(header);
  const split = wordChild(props, "cantSplit");
  if (split) format.allowSplit = !enabled(split);
  const height = wordChild(props, "trHeight");
  const value = num(height, "val", 20);
  const rule = wordAttribute(height, "hRule");
  if (value !== undefined) {
    format.height = value;
    if (["atLeast", "exact"].includes(rule))
      format.heightRule = rule as "atLeast" | "exact";
  }
  return format;
}
function readCellFormat(props: Element | undefined): WordTableCellFormatting {
  if (!props) return {};
  const format: WordTableCellFormatting = {};
  const alignment = wordAttribute(wordChild(props, "vAlign"));
  if (["top", "center", "bottom"].includes(alignment))
    format.verticalAlign =
      alignment as WordTableCellFormatting["verticalAlign"];
  const dir = wordAttribute(wordChild(props, "textDirection"));
  if (["lrTb", "tbRl", "btLr"].includes(dir))
    format.textDirection = {
      lrTb: "horizontal",
      tbRl: "vertical",
      btLr: "vertical270",
    }[dir] as WordTableCellFormatting["textDirection"];
  const margins = readMargins(wordChild(props, "tcMar"));
  if (margins) format.margins = margins;
  const borders = readWordBorders(wordChild(props, "tcBorders"));
  if (borders) format.borders = borders;
  const fill = wordAttribute(wordChild(props, "shd"), "fill");
  if (color(fill)) format.shading = normalizeColor(fill);
  const wrap = wordChild(props, "noWrap");
  if (wrap) format.noWrap = enabled(wrap);
  return format;
}

export function readWordTableContent<T>(
  table: Element,
  readBlocks?: (elements: Element[]) => T[],
): WordTableContent<T> {
  const rows = children(table, "tr");
  const active = new Map<number, { cell: WordTableCell<T>; width: number }>();
  let supported = sourcePatchSupported(table);
  const inventory: WordTableContent<T>["rows"] = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    const cells: WordTableContent<T>["rows"][number]["cells"] = [];
    let column = 0;
    const continued = new Set<number>();
    children(row, "tc").forEach((cell, sourceIndex) => {
      const props = wordChild(cell, "tcPr");
      const span = Number(wordAttribute(wordChild(props, "gridSpan"))) || 1;
      const merge = wordChild(props, "vMerge");
      const continuation = merge && wordAttribute(merge) !== "restart";
      const owner = active.get(column);
      if (continuation && owner && owner.width === span) {
        owner.cell.rowSpan = (owner.cell.rowSpan ?? 1) + 1;
        continued.add(column);
      } else {
        if (continuation) supported = false;
        const blocks = readBlocks?.(
          Array.from(cell.children).filter((e) => e !== props),
        );
        const entry = {
          sourceIndex,
          text: cellText(cell),
          colSpan: span,
          rowSpan: 1,
          format: readCellFormat(props),
          ...(blocks ? { blocks } : {}),
        };
        cells.push(entry);
        active.delete(column);
        if (merge && !continuation) {
          active.set(column, { cell: entry, width: span });
          continued.add(column);
        }
      }
      column += span;
    });
    for (const key of active.keys())
      if (!continued.has(key)) active.delete(key);
    inventory.push({
      sourceIndex: rowIndex,
      format: readRowFormat(wordChild(row, "trPr")),
      cells,
    });
  }
  const tblGrid = wordChild(table, "tblGrid");
  return {
    columns: tblGrid
      ? children(tblGrid, "gridCol").map(
          (e) => (Number(wordAttribute(e, "w")) || 0) / 20,
        )
      : [],
    format: readTableFormat(wordChild(table, "tblPr")),
    rows: inventory,
    sourcePatchSupported: supported,
  };
}
