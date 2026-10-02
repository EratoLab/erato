import { wordChild, WORDPROCESSING_NS as W } from "./wordBlockFormatting";

export interface WordTableCellTextEdit {
  expectedText: string;
  text: string;
}

const plainText = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= 10000 &&
  !/[\u0000-\u001f\u007f\uD800-\uDFFF\uFFFE\uFFFF]/u.test(value);

export function parseWordTableCellTextEdit(
  value: unknown,
): WordTableCellTextEdit | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const edit = value as Record<string, unknown>;
  return Object.keys(edit).every((key) =>
    ["expectedText", "text"].includes(key),
  ) &&
    plainText(edit.expectedText) &&
    plainText(edit.text)
    ? { expectedText: edit.expectedText, text: edit.text }
    : null;
}

/** Narrow native operation: one paragraph, plain runs with identical formatting.
 * Preserve all paragraph/run properties rather than round-tripping known styles.
 */
export function wordTableCellTextEditIssue(
  cell: Element,
  edit: WordTableCellTextEdit,
): string | undefined {
  const only = (parent: Element, names: string[]) =>
    Array.from(parent.children).every(
      (child) => child.namespaceURI === W && names.includes(child.localName),
    );
  const paragraphs = Array.from(cell.children).filter(
    (e) => e.namespaceURI === W && e.localName === "p",
  );
  if (!only(cell, ["tcPr", "p"]) || paragraphs.length !== 1)
    return "table-cell-content";
  const paragraph = paragraphs[0];
  if (!only(paragraph, ["pPr", "r"])) return "table-cell-content";
  const runs = Array.from(paragraph.children).filter(
    (e) => e.localName === "r",
  );
  if (
    !runs.length ||
    runs.some(
      (run) =>
        !only(run, ["rPr", "t"]) ||
        !Array.from(run.children).some((e) => e.localName === "t"),
    )
  )
    return "table-cell-content";
  const serializer = new XMLSerializer();
  const formats = runs.map((run) => {
    const props = wordChild(run, "rPr");
    return props ? serializer.serializeToString(props) : "";
  });
  if (
    formats.some((format) => format !== formats[0]) ||
    [
      "vanish",
      "webHidden",
      "ins",
      "del",
      "moveFrom",
      "moveTo",
      "rPrChange",
      "pPrChange",
    ].some((name) => paragraph.getElementsByTagNameNS(W, name).length > 0)
  )
    return "table-cell-content";
  const text = Array.from(paragraph.getElementsByTagNameNS(W, "t"))
    .map((node) => node.textContent)
    .join("");
  return text === edit.expectedText ? undefined : "table-cell-text-mismatch";
}

/** The caller owns this cloned cell; never mutate the captured source. */
export function applyWordTableCellTextEdit(
  cell: Element,
  edit: WordTableCellTextEdit,
): void {
  const issue = wordTableCellTextEditIssue(cell, edit);
  if (issue) throw new Error(issue);
  Array.from(cell.getElementsByTagNameNS(W, "t")).forEach((node, index) => {
    node.textContent = index === 0 ? edit.text : "";
    node.setAttributeNS(
      "http://www.w3.org/XML/1998/namespace",
      "xml:space",
      "preserve",
    );
  });
}
