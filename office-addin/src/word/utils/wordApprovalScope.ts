import { clientToolScopeChanged } from "@erato/frontend/library";

import {
  wordChangeEventsActive,
  wordChangePosition,
  wordChangesSince,
} from "./wordChangeJournal";

import type { WordChangePosition } from "./wordChangeJournal";
import type {
  ClientToolApprovalScope,
  ClientToolExecutionResult,
  ClientToolExecutorOptions,
} from "@erato/frontend/library";

/**
 * A document approval (contract §16, ERMAIN-1033) holds while the journal has seen no change to
 * the text but the pane's own since the position taken when the user allowed it. Formatting-only
 * edits on Windows and Mac, Track Changes toggles and Word's proofing make no entry, so they never
 * end one; Apply re-checks the live document. On Word for the web a formatting edit is a `local`
 * entry and ends it.
 */
export type WordApprovalScopeCheck =
  | { read: true }
  | { read: false; result: ClientToolExecutionResult };

const SCOPE_CHANGED_MESSAGE =
  "The document changed outside this chat since the user allowed reading it, so it was not read. The user is asked again.";

function isWordChangePosition(value: unknown): value is WordChangePosition {
  if (typeof value !== "object" || value === null) return false;
  const position = value as Record<string, unknown>;
  return (
    typeof position.journal === "string" &&
    Number.isInteger(position.seq) &&
    position.events === true
  );
}

/**
 * For a grant read, after its lineage check and before it reads: whether a call covered by a
 * document approval may read. A call without one was allowed on its own and reads.
 */
export function checkWordApprovalScope(
  scope: ClientToolApprovalScope | undefined,
): WordApprovalScopeCheck {
  if (!scope) return { read: true };
  if (!isWordChangePosition(scope.position)) return changed();
  // other-journal after a reload, no-events, or out-of-range once older entries were dropped.
  const since = wordChangesSince(scope.position);
  if (!since.ok) return changed();
  return since.entries.every((entry) => entry.source === "own")
    ? { read: true }
    : changed();
}

function changed(): WordApprovalScopeCheck {
  return { read: false, result: clientToolScopeChanged(SCOPE_CHANGED_MESSAGE) };
}

/**
 * The read tool's registration options. `identity` is the pane's binding identity, the scope id
 * the server derives for this document in this pane session. Without paragraph events the pane
 * cannot see a change, so it neither lists the check nor takes a position, and every call asks.
 */
export function wordApprovalScopeOptions(
  identity: () => string | undefined,
): Pick<
  ClientToolExecutorOptions,
  "checksApprovalScope" | "anchorsApprovalScope"
> {
  return {
    checksApprovalScope: wordChangeEventsActive,
    anchorsApprovalScope: (scope) =>
      scope.hostContext === "word_document" &&
      scope.covers === "document" &&
      scope.scopeId === identity() &&
      wordChangeEventsActive()
        ? () => wordChangePosition()
        : undefined,
  };
}
