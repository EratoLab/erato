import {
  MAX_PLAN_BYTES,
  wordSourceReadRefs,
  normalizeWordDocumentPlan,
  parseWordDocumentPlan,
  validateWordDocumentPlan,
  wordTableCellScope,
  expandWordTableCellSubmission,
  WordTableCellSubmissionError,
  WORD_SUBMIT_PLAN_ACTION,
  WORD_SUBMIT_PLAN_TOOL,
} from "@erato/frontend/word-review";

import { WordDraftRepairError } from "./wordDocumentDrafts";
import {
  captureWordAuthoringSnapshot,
  compileWordDocumentPlan,
  verifyWordPlanOutput,
} from "./wordDocumentXml";

import type { WordDocumentReadSession } from "./wordDocumentReadTool";
import type {
  ClientToolExecutor,
  ClientToolCallContext,
  ClientToolExecutionResult,
} from "@erato/frontend/library";
import type { WordPlanDiagnostics } from "@erato/frontend/word-review";

export { WORD_SUBMIT_PLAN_ACTION, WORD_SUBMIT_PLAN_TOOL };

export function createWordDocumentSubmissionExecutor(
  session: WordDocumentReadSession,
): ClientToolExecutor {
  return async (input, context) => {
    if (!context || context.signal?.aborted)
      return {
        ok: false,
        error: "Document submission unavailable or stopped.",
      };
    const snapshot = session.snapshotForSubmission(context);
    if (!snapshot || !object(input))
      return prepareWordDocumentSubmission(input, context, session);
    let serialized: string;
    try {
      serialized = JSON.stringify(input);
    } catch {
      return { ok: false, error: "Expected JSON plan arguments." };
    }
    if (new TextEncoder().encode(serialized).length > MAX_PLAN_BYTES)
      return {
        ok: false,
        error: "Document plan exceeds maxPlanBytes.",
        validationErrors: [
          {
            path: "",
            code: "too-large",
            message: "Submission arguments exceed maxPlanBytes.",
          },
        ],
      };
    try {
      const previous = session.drafts.replay(context.toolCallId, serialized);
      if (previous) return previous;
      // Redelivery returns its receipt even if Apply has since consumed the
      // capture. New calls still require the original completed, active read.
      const scoped = wordTableCellScope(snapshot, input.readToken);
      if (scoped && !("table_cell" in input))
        return {
          ok: false,
          error:
            "A scoped read permits only a concise table_cell submission. Complete the full read for plans or repairs.",
          validationErrors: [
            {
              path: "/readToken",
              code: "outside-read-scope",
              message:
                "Scoped tokens cannot submit full plans or draft repairs.",
            },
          ],
        };
      if (
        snapshot.revoked ||
        snapshot.used ||
        snapshot.issue ||
        input.snapshot !== snapshot.token ||
        (!scoped &&
          (!snapshot.readToken ||
            wordSourceReadRefs(snapshot).some(
              (ref) => !snapshot.read.has(ref),
            ) ||
            input.readToken !== snapshot.readToken))
      )
        return prepareWordDocumentSubmission(input, context, session);
      if (session.drafts.accepted)
        return {
          ok: false,
          error: "A document plan has already been accepted for this request.",
        };
      const submitted = JSON.parse(serialized) as Record<string, unknown>;
      const value =
        "table_cell" in submitted
          ? expandWordTableCellSubmission(submitted, snapshot)
          : session.drafts.materialize(submitted);
      const prepared = await prepareWordDocumentSubmission(
        value,
        context,
        session,
      );
      // The read session may have been cleared while preparation was pending.
      if (
        context.signal?.aborted ||
        session.snapshotForSubmission(context) !== snapshot ||
        snapshot.revoked
      )
        return { ok: false, error: "Document submission stopped." };
      const redelivery = session.drafts.replay(context.toolCallId, serialized);
      if (redelivery) return redelivery;
      let result = prepared;
      if (prepared.ok) {
        session.drafts.accepted = true;
        if (
          ("draft_id" in input || "table_cell" in input) &&
          prepared.disposition !== "local_only"
        )
          result = {
            ...prepared,
            result: { ...(prepared.result as object), plan: value },
          };
      } else if (!scoped && prepared.validationErrors?.length) {
        const feedback = session.drafts.reject(
          value as unknown as Record<string, unknown>,
          prepared.validationErrors,
        );
        result = {
          ...prepared,
          submissionFeedback: feedback,
          ...(feedback.terminal
            ? {
                error:
                  "The same document proposal failed with unchanged diagnostics.",
                validationErrors: [
                  {
                    path: "",
                    code: "no-progress",
                    message:
                      "The proposal and validation errors are unchanged. This submission turn has ended.",
                  },
                  ...prepared.validationErrors,
                ].slice(0, 16),
              }
            : {}),
        };
      }
      return session.drafts.remember(context.toolCallId, serialized, result);
    } catch (error) {
      if (
        !(error instanceof WordDraftRepairError) &&
        !(error instanceof WordTableCellSubmissionError)
      )
        throw error;
      const failure: ClientToolExecutionResult = {
        ok: false,
        error:
          error instanceof WordDraftRepairError
            ? "Document repair rejected."
            : "Table cell edit rejected.",
        ...(error instanceof WordDraftRepairError
          ? { submissionFeedback: session.drafts.feedback() }
          : {}),
        validationErrors: [
          { path: error.path, code: error.code, message: error.message },
        ],
      };
      return error.code === "call-conflict"
        ? failure
        : session.drafts.remember(context.toolCallId, serialized, failure);
    }
  };
}

async function prepareWordDocumentSubmission(
  input: unknown,
  context: ClientToolCallContext | undefined,
  session: WordDocumentReadSession,
): Promise<ClientToolExecutionResult> {
  if (!context || context.signal?.aborted)
    return {
      ok: false,
      error: "Document submission unavailable or stopped.",
    };
  const snapshot = session.snapshotForSubmission(context);
  if (!snapshot)
    return {
      ok: false,
      error: "This request has no completed document read.",
      validationErrors: [
        {
          path: "/snapshot",
          code: "wrong-request",
          message:
            "The snapshot must have been read by this chat and assistant request.",
        },
      ],
    };
  const issues: WordPlanDiagnostics = [];
  let content: string;
  try {
    content = JSON.stringify(input);
  } catch {
    return { ok: false, error: "Expected JSON plan arguments." };
  }
  const parsed = parseWordDocumentPlan(content, issues);
  const plan = parsed && normalizeWordDocumentPlan(parsed, snapshot);
  const invalid = !plan || validateWordDocumentPlan(plan, snapshot, issues);
  if (invalid)
    return {
      ok: false,
      error: "Document plan validation failed.",
      validationErrors: issues,
    };
  try {
    const compiled = compileWordDocumentPlan(plan, snapshot);
    const prepared = captureWordAuthoringSnapshot(
      compiled,
      snapshot.identity,
      "Off",
      snapshot.fullDocument,
      "verify",
    );
    if (prepared.issue || !verifyWordPlanOutput(plan, snapshot, prepared))
      return {
        ok: false,
        error: "Document plan preparation failed.",
        validationErrors: [
          {
            path: "",
            code: "compile-verification",
            message:
              "The compiled structure did not match the proposed plan. Check source references, object constraints, stories and section layout.",
          },
        ],
      };
  } catch (error) {
    // Return schema paths and constraints, never document contents, in parser diagnostics.
    const hints: Record<string, string> = {
      "Unknown or repeated source row":
        "Table row sourceIndex must identify a unique row in the selected source table.",
      "Unknown or repeated source cell":
        "Table cell sourceIndex must identify a unique cell in the selected source row.",
      "Source table wrappers require explicit replacement":
        "This table cannot be patched by reference; provide a new table with complete cell contents and no sourceRef or sourceIndex.",
      "Duplicate bookmark name":
        "Bookmark names must be unique across the resulting document.",
      "Overlapping native edit targets":
        "Native edit targets cannot overlap within a source fragment.",
      "table-cell-content":
        "textEdit requires an unmerged retained cell containing one plain-text paragraph with uniform run formatting.",
      "table-cell-text-mismatch":
        "textEdit.expectedText must match the original captured cell text exactly.",
    };
    return {
      ok: false,
      error: "Document plan preparation failed.",
      validationErrors: [
        {
          path: "",
          code: "compile-plan",
          message:
            (error instanceof Error && hints[error.message]) ||
            "The plan could not be compiled against its captured sources. Check native targets, retained table cells, bookmark names, stories and section layout.",
        },
      ],
    };
  }
  if (context.signal?.aborted)
    return { ok: false, error: "Document submission stopped." };
  // Key by tool call ID so a retried submission POST returns the same receipt.
  return {
    ok: true,
    result: {
      draft_id: context.toolCallId,
      snapshot: plan.snapshot,
      action: WORD_SUBMIT_PLAN_ACTION,
    },
  };
}

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
