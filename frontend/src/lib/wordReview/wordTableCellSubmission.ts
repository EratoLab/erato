import { WORDPROCESSING_NS as W } from "./wordBlockFormatting";
import { wordTableCellScope } from "./wordTableCellScope";
import {
  parseWordTableCellTextEdit,
  wordTableCellTextEditIssue,
} from "./wordTableCellText";

import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
} from "./wordDocumentPlan";

export class WordTableCellSubmissionError extends Error {
  constructor(
    readonly path: string,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const only = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
const index = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const direct = (parent: Element, name: string) =>
  Array.from(parent.children).filter(
    (e) => e.namespaceURI === W && e.localName === name,
  );

/** Expand one exact body-table cell edit into the canonical complete plan. */
export function expandWordTableCellSubmission(
  input: Record<string, unknown>,
  snapshot: WordAuthoringSnapshot,
): WordDocumentPlan {
  const fail = (path: string, code: string, message: string): never => {
    throw new WordTableCellSubmissionError(path, code, message);
  };
  if (
    input.snapshot !== snapshot.token ||
    snapshot.revoked ||
    snapshot.used ||
    snapshot.issue
  )
    return fail(
      "/snapshot",
      "expired",
      "Use the current request's active, available snapshot.",
    );
  const scope = wordTableCellScope(snapshot, input.readToken);
  if ((!snapshot.readToken || input.readToken !== snapshot.readToken) && !scope)
    return fail(
      "/readToken",
      "incomplete-read",
      "Use the completed readToken from this request.",
    );
  const edit = input.table_cell;
  if (
    !only(input, ["snapshot", "readToken", "table_cell"]) ||
    !object(edit) ||
    !only(edit, [
      "sourceRef",
      "rowIndex",
      "cellIndex",
      "expectedText",
      "text",
    ]) ||
    typeof edit.sourceRef !== "string" ||
    !index(edit.rowIndex) ||
    !index(edit.cellIndex)
  )
    return fail(
      "/table_cell",
      "table-cell-shape",
      "Use snapshot, readToken and table_cell:{sourceRef,rowIndex,cellIndex,expectedText,text}; indexes are original zero-based row and physical cell indexes.",
    );
  if (
    scope &&
    (edit.sourceRef !== scope.sourceRef ||
      edit.rowIndex !== scope.rowIndex ||
      edit.cellIndex !== scope.cellIndex ||
      edit.expectedText !== scope.expectedText)
  )
    return fail(
      "/table_cell",
      "outside-read-scope",
      "The scoped read authorizes only its exact returned cell and expectedText.",
    );
  const textEdit = parseWordTableCellTextEdit({
    expectedText: edit.expectedText,
    text: edit.text,
  });
  if (!textEdit)
    return fail(
      "/table_cell",
      "table-cell-text-edit",
      "expectedText and text must be single-line strings of at most 10000 characters.",
    );
  const source = snapshot.blocks.find(
    (b) =>
      b.ref === edit.sourceRef ||
      b.objects?.some((o) => o.kind === "table" && o.ref === edit.sourceRef),
  );
  if (!source)
    return fail(
      "/table_cell/sourceRef",
      "table-cell-reference",
      "Use a body table reference returned by the completed read.",
    );
  const content = source.content;
  const root = new DOMParser().parseFromString(
    source.xml,
    "application/xml",
  ).documentElement;
  const table = root.localName === "tbl" ? root : direct(root, "tbl")[0];
  if (
    source.nativeKind !== "table" ||
    !content?.sourcePatchSupported ||
    !table ||
    (root !== table && root.children.length !== 1) ||
    table.getElementsByTagNameNS(W, "tbl").length ||
    content.rows.some((r) =>
      r.cells.some((c) => (c.colSpan ?? 1) !== 1 || (c.rowSpan ?? 1) !== 1),
    )
  )
    return fail(
      "/table_cell/sourceRef",
      "table-cell-content",
      "Concise edits support standalone, unmerged body tables only. Use a complete plan for nested tables, wrappers or merged cells.",
    );
  const row = direct(table, "tr")[edit.rowIndex];
  const cell = row && direct(row, "tc")[edit.cellIndex];
  if (!cell)
    return fail(
      "/table_cell",
      "table-cell-reference",
      "The original row or physical cell index is outside this table.",
    );
  const issue = wordTableCellTextEditIssue(cell, textEdit);
  if (issue)
    return fail(
      issue === "table-cell-text-mismatch"
        ? "/table_cell/expectedText"
        : "/table_cell",
      issue,
      issue === "table-cell-text-mismatch"
        ? "expectedText must match the captured cell text exactly."
        : "The cell must contain one plain-text paragraph with uniform run formatting. Use a complete plan for rich content.",
    );
  return {
    version: 1,
    snapshot: snapshot.token,
    readToken: input.readToken as string,
    scope: "body",
    deleted: [],
    entries: snapshot.blocks.map((block) =>
      block !== source
        ? { kind: "keep", source: [block.ref] }
        : {
            kind: "replace",
            source: [block.ref],
            blocks: [
              {
                id: "cell-edit-table",
                type: "table",
                text: "",
                sourceRef: edit.sourceRef as string,
                rows: content.rows.map((r) => ({
                  sourceIndex: r.sourceIndex,
                  cells: r.cells.map((c) => ({
                    sourceIndex: c.sourceIndex,
                    ...(r.sourceIndex === edit.rowIndex &&
                    c.sourceIndex === edit.cellIndex
                      ? { textEdit }
                      : {}),
                  })),
                })),
              },
            ],
          },
    ),
  };
}
