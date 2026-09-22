import {
  wordAttribute,
  wordChild,
  WORDPROCESSING_NS as W,
} from "./wordBlockFormatting";

const direct = (parent: Element, name: string) =>
  Array.from(parent.children).filter(
    (e) => e.namespaceURI === W && e.localName === name,
  );
const positiveInteger = (value: string) =>
  /^\d+$/.test(value) &&
  Number.isSafeInteger(Number(value)) &&
  Number(value) > 0;

function automaticLayout(doc: Document, table: Element): boolean {
  const props = wordChild(table, "tblPr");
  const layout = wordChild(props, "tblLayout");
  if (layout) return wordAttribute(layout, "type") === "autofit";
  const styles = Array.from(doc.getElementsByTagNameNS(W, "style")).filter(
    (style) => wordAttribute(style, "type") === "table",
  );
  let id =
    wordAttribute(wordChild(props, "tblStyle")) ||
    wordAttribute(
      styles.find((style) =>
        ["1", "on", "true"].includes(wordAttribute(style, "default")),
      ),
      "styleId",
    );
  const seen = new Set<string>();
  while (id) {
    if (seen.has(id)) return false;
    seen.add(id);
    const style = styles.find((item) => wordAttribute(item, "styleId") === id);
    if (!style) return false;
    const inherited = wordChild(wordChild(style, "tblPr"), "tblLayout");
    if (inherited) return wordAttribute(inherited, "type") === "autofit";
    id = wordAttribute(wordChild(style, "basedOn"));
  }
  return true;
}

/** Word recomputes AutoFit grids after section-width changes while retaining cell-width constraints.
 * Normalize only a comparison copy, never the capture or its stale-state fingerprint. */
export function normalizeWordTablesForComparison(doc: Document): void {
  for (const name of ["tblBorders", "tcBorders"])
    for (const borders of doc.getElementsByTagNameNS(W, name)) {
      for (const border of Array.from(borders.children))
        if (border.namespaceURI === W && wordAttribute(border, "space") === "0")
          border.removeAttributeNS(W, "space");
    }
  for (const table of doc.getElementsByTagNameNS(W, "tbl")) {
    if (!automaticLayout(doc, table)) continue;
    const grid = wordChild(table, "tblGrid");
    const columns = grid ? direct(grid, "gridCol") : [];
    if (
      !columns.length ||
      columns.length > 63 ||
      grid!.children.length !== columns.length ||
      !columns.every((column) => positiveInteger(wordAttribute(column, "w")))
    )
      continue;
    const rows = direct(table, "tr");
    if (
      !rows.length ||
      Array.from(table.children).some(
        (e) =>
          e.namespaceURI !== W ||
          !["tblPr", "tblGrid", "tr"].includes(e.localName),
      )
    )
      continue;
    const independentlyConstrained = new Set<number>();
    const complete = rows.every((row) => {
      const props = wordChild(row, "trPr");
      if (
        wordChild(props, "gridBefore") ||
        wordChild(props, "gridAfter") ||
        Array.from(row.children).some(
          (e) =>
            e.namespaceURI !== W ||
            !["trPr", "tblPrEx", "tc"].includes(e.localName),
        )
      )
        return false;
      let column = 0;
      for (const cell of direct(row, "tc")) {
        const cellProps = wordChild(cell, "tcPr");
        const width = wordChild(cellProps, "tcW");
        const span = wordAttribute(wordChild(cellProps, "gridSpan")) || "1";
        if (
          !positiveInteger(span) ||
          wordChild(cellProps, "hMerge") ||
          wordAttribute(width, "type") !== "dxa" ||
          !positiveInteger(wordAttribute(width, "w"))
        )
          return false;
        if (Number(span) === 1) independentlyConstrained.add(column);
        column += Number(span);
      }
      return column === columns.length;
    });
    if (complete && independentlyConstrained.size === columns.length)
      for (const column of columns) column.removeAttributeNS(W, "w");
  }
}
