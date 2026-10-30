import {
  MAX_PLAN_BYTES,
  wordSourceReadRefs,
  normalizeWordDocumentPlan,
  parseWordDocumentPlan,
  validateWordDocumentPlan,
  expandWordTableCellSubmission,
  WordTableCellSubmissionError,
  WORD_SUBMIT_PLAN_ACTION,
  WORD_SUBMIT_PLAN_TOOL,
  wordReadScope,
} from "@erato/frontend/word-review";

import { wordApplyHost, wordApplyPolicy } from "./wordApplyPolicy";
import { WordDraftRepairError } from "./wordDocumentDrafts";
import {
  captureWordAuthoringSnapshot,
  compileWordDocumentPlan,
  verifyWordPlanOutput,
} from "./wordDocumentXml";
import { wordHostPlatform } from "./wordHostPlatform";
import { wordInPlaceFallbacks } from "./wordInPlacePlan";
import { routeWordDocumentPlan, wordPlanReadScope } from "./wordInPlaceRoute";
import {
  isWordTrackingMode,
  wordInPlaceAvailability,
  wordInPlaceCapabilitiesUnder,
} from "./wordInPlaceSwitch";
import { wordDocumentChangedRefusal } from "./wordPlanDocumentChanges";
import { expandWordScopedSubmission } from "./wordScopedSubmission";

import type { WordDocumentReadSession } from "./wordDocumentReadTool";
import type {
  ClientToolExecutor,
  ClientToolCallContext,
  ClientToolExecutionResult,
} from "@erato/frontend/library";
import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
  WordPlanDiagnostics,
} from "@erato/frontend/word-review";

export { WORD_SUBMIT_PLAN_ACTION, WORD_SUBMIT_PLAN_TOOL };

type WordScopedSubmissionKind = "scoped_edit" | "table_cell";

export function createWordDocumentSubmissionExecutor(
  session: WordDocumentReadSession,
): ClientToolExecutor {
  const execute = createSubmissionExecutor(session);
  return async (input, context) => {
    const result = await execute(input, context);
    if (result.ok) return result;
    const snapshot = context && session.snapshotForSubmission(context);
    const unavailable =
      !snapshot ||
      snapshot.revoked ||
      snapshot.used ||
      !!snapshot.issue ||
      context?.signal?.aborted;
    const needsRead = result.validationErrors?.some(({ code }) =>
      [
        "too-large",
        "incomplete-read",
        "expired",
        "outside-read-scope",
        "in-place-unavailable",
      ].includes(code),
    );
    return {
      ...result,
      validationErrors: result.validationErrors?.length
        ? result.validationErrors
        : [{ path: "", code: "submission-unavailable", message: result.error }],
      submissionFeedback: {
        ...result.submissionFeedback,
        terminal: unavailable || result.submissionFeedback?.terminal || false,
        recovery: unavailable
          ? "cannot_continue"
          : (result.submissionFeedback?.recovery ??
            (needsRead ? "read_current_context" : "repair_arguments")),
      },
    };
  };
}

function createSubmissionExecutor(
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
      const scoped = wordReadScope(snapshot, input.readToken);
      if (
        scoped &&
        !(scoped.kind === "objects"
          ? "scoped_edit" in input
          : "table_cell" in input)
      )
        return {
          ok: false,
          error:
            "A scoped read permits only its concise edit format. Complete the full read for plans or repairs.",
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
      const kind: WordScopedSubmissionKind | undefined =
        "scoped_edit" in submitted
          ? "scoped_edit"
          : "table_cell" in submitted
            ? "table_cell"
            : undefined;
      const value =
        kind === "scoped_edit"
          ? expandWordScopedSubmission(submitted, snapshot)
          : kind === "table_cell"
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
      const changed = wordDocumentChangedRefusal(
        snapshot,
        session.capture,
        kind ? (value as WordDocumentPlan) : "document",
      );
      if (changed)
        return session.drafts.remember(context.toolCallId, serialized, changed);
      let result = prepared;
      if (prepared.ok) {
        session.drafts.accepted = true;
        if (
          ("draft_id" in input ||
            "table_cell" in input ||
            "scoped_edit" in input) &&
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
            : "Scoped edit rejected.",
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
    if (isWordTrackingMode(snapshot.trackingMode)) {
      const availability = wordInPlaceAvailability();
      const reasons = availability.enabled
        ? wordInPlaceFallbacks(
            plan,
            snapshot,
            wordInPlaceCapabilitiesUnder(snapshot.trackingMode),
            prepared,
          )
        : [availability.reason];
      if (reasons.length)
        return {
          ok: false,
          error: "Document plan needs a full rewrite under Track Changes.",
          validationErrors: [
            {
              path: "",
              code: "tracking-needs-import",
              message: `Track Changes is on, so only in-place text and paragraph edits can be applied; Word records them as tracked changes. This plan needs a full-document rewrite because of: ${reasons.join(", ")}. Resubmit only edits that avoid these reasons, such as rewording existing paragraphs, headings, list items or table cells, or tell the user that Track Changes must be turned off for this change.`,
            },
          ],
        };
    }
    const wholeDocument = scopedWholeDocumentReasons(plan, snapshot, prepared);
    if (wholeDocument)
      return scopedWholeDocumentRefusal(wholeDocument, snapshot);
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
    const attribution =
      error instanceof Error && error.message === "comment-attribution-changed";
    return {
      ok: false,
      error: "Document plan preparation failed.",
      validationErrors: [
        {
          path: "",
          code: attribution ? "comment-attribution-changed" : "compile-plan",
          message: attribution
            ? "The compiled plan would change the author, initials or date of a comment it keeps, or the people part. Plans never change comments; keep the commented text or ask the user."
            : (error instanceof Error && hints[error.message]) ||
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

interface WordScopedWholeDocument {
  reasons: string[];
  /** In-place writing is off for the host or session, so no edit could be written in place. */
  hostWide: boolean;
}

/**
 * Apply never lets a plan from a scoped read replace the whole document unless the host's policy
 * allows that outright, so such a plan the in-place writer cannot take is refused here, where the
 * model can still resubmit, rather than on the card.
 */
function scopedWholeDocumentReasons(
  plan: WordDocumentPlan,
  snapshot: WordAuthoringSnapshot,
  prepared: WordAuthoringSnapshot,
): WordScopedWholeDocument | undefined {
  if (
    !wordPlanReadScope(plan, snapshot) ||
    wordApplyPolicy().wholeDocumentImport === "allowed"
  )
    return undefined;
  const availability = wordInPlaceAvailability();
  const caps = wordInPlaceCapabilitiesUnder(snapshot.trackingMode);
  const route = routeWordDocumentPlan(
    plan,
    snapshot,
    availability,
    caps,
    prepared,
  );
  if (route.route === "in-place") return undefined;
  if (route.route === "body")
    return { reasons: ["no-package"], hostWide: true };
  if (!availability.enabled)
    return { reasons: [availability.reason], hostWide: true };
  let reasons: string[] = [];
  try {
    reasons = wordInPlaceFallbacks(plan, snapshot, caps, prepared);
  } catch {
    // The route already read the classifier failure as program-mismatch.
  }
  return {
    reasons: reasons.length ? reasons : [route.reason],
    hostWide: false,
  };
}

/** Where nothing can be written in place, a smaller scoped edit cannot help; under `confirm` a full
 * plan still reaches the card's confirmation. */
function scopedWholeDocumentRefusal(
  { reasons, hostWide }: WordScopedWholeDocument,
  snapshot: WordAuthoringSnapshot,
): ClientToolExecutionResult {
  const web = wordApplyHost(wordHostPlatform()) === "web";
  const host = web ? "Word for the web" : "This Word host";
  const because = `because of: ${reasons.join(", ")}.`;
  const fullPlan =
    hostWide &&
    wordApplyPolicy().wholeDocumentImport === "confirm" &&
    !snapshot.completeReadIssue;
  const message = !hostWide
    ? `${host} writes edits from a scoped read only in place, and this edit needs a full-document rewrite ${because} Resubmit only edits that can be written in place, such as rewording existing paragraphs, headings, list items or table cells, or tell the user that this change ${web ? "needs Word for Windows or Mac" : "can't be made in this version of Word"}.`
    : `${host} can't write any edit in place right now ${because} An edit from a scoped read never replaces the whole document, so ${
        fullPlan
          ? "complete the full read and submit a full-document plan instead; the user is asked to confirm before it replaces the whole document."
          : web
            ? "tell the user that this change needs Word for Windows or Mac."
            : "tell the user that this change can't be made in this version of Word right now."
      }`;
  return {
    ok: false,
    error: "Scoped edit needs a full-document rewrite.",
    validationErrors: [
      {
        path: "",
        code: fullPlan ? "in-place-unavailable" : "web-needs-whole-document",
        message,
      },
    ],
  };
}

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
