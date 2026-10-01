import { parseWordDocumentPlan } from "./wordDocumentPlan";
import { expandWordTableCellSubmission } from "./wordTableCellSubmission";

import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
} from "./wordDocumentPlan";

/** Host-owned capability. It is never deserialized from model arguments. */
export interface WordTableCellScope {
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
  const scope =
    typeof token === "string" ? snapshot.cellReads?.get(token) : undefined;
  return scope?.snapshot === snapshot.token &&
    scope.identity === snapshot.identity &&
    scope.fingerprint === snapshot.fingerprint &&
    !snapshot.revoked &&
    !snapshot.used &&
    !snapshot.issue
    ? scope
    : undefined;
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
    const stable = (value: unknown) =>
      JSON.stringify(value, (_key, item: unknown) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? Object.fromEntries(
              Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
            )
          : item,
      );
    return (
      stable(plan) === stable(parseWordDocumentPlan(JSON.stringify(expected)))
    );
  } catch {
    return false;
  }
}
