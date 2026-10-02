import { parseWordDocumentPlan } from "./wordDocumentPlan";
import { canonicalWordPlan, wordReadScope } from "./wordReadScope";
import { expandWordTableCellSubmission } from "./wordTableCellSubmission";

import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
} from "./wordDocumentPlan";

/** Host-owned capability. It is never deserialized from model arguments. */
export interface WordTableCellScope {
  kind: "table-cell";
  snapshot: string;
  identity: string;
  fingerprint: string;
  sourceRef: string;
  rowIndex: number;
  cellIndex: number;
  expectedText: string;
}

export function wordTableCellScope(
  snapshot: WordAuthoringSnapshot,
  token: unknown,
): WordTableCellScope | undefined {
  const scope = wordReadScope(snapshot, token);
  return scope?.kind === "table-cell" ? scope : undefined;
}

/** Review and Apply revalidate the entire materialized plan, including every keep.
 * A scoped token can never authorize reordering, formatting, deletion or another cell.
 */
export function wordPlanMatchesCellScope(
  plan: WordDocumentPlan,
  snapshot: WordAuthoringSnapshot,
): boolean {
  const scope = wordTableCellScope(snapshot, plan.readToken);
  if (!scope) return false;
  const replacement = plan.entries.find((e) => e.kind === "replace");
  const table =
    replacement?.kind === "replace" ? replacement.blocks[0] : undefined;
  if (table?.type !== "table") return false;
  const edit = table.rows
    .find((r) => r.sourceIndex === scope.rowIndex)
    ?.cells.find((c) => c.sourceIndex === scope.cellIndex)?.textEdit;
  if (!edit) return false;
  try {
    const expected = expandWordTableCellSubmission(
      {
        snapshot: snapshot.token,
        readToken: plan.readToken,
        table_cell: {
          sourceRef: scope.sourceRef,
          rowIndex: scope.rowIndex,
          cellIndex: scope.cellIndex,
          expectedText: scope.expectedText,
          text: edit.text,
        },
      },
      snapshot,
    );
    return (
      canonicalWordPlan(plan) ===
      canonicalWordPlan(parseWordDocumentPlan(JSON.stringify(expected)))
    );
  } catch {
    return false;
  }
}
