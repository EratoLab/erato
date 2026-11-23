import {
  MAX_PLAN_BYTES,
  MAX_WORD_SCOPE_BYTES,
  wordSourceReadRefs,
  normalizeWordDocumentPlan,
  parseWordDocumentPlan,
  validateWordDocumentPlan,
  expandWordTableCellSubmission,
  WordTableCellSubmissionError,
  WORD_SUBMIT_PLAN_ACTION,
  WORD_SUBMIT_PLAN_TOOL,
  wordReadScope,
  WORD_MORE_CHANGES_ARGUMENT,
} from "@erato/frontend/word-review";

import { rememberWordAcceptedPlan } from "./wordAcceptedSubmissions";
import { wordApplyHost, wordApplyPolicy } from "./wordApplyPolicy";
import { wordPlanApprovalPreview } from "./wordApprovalPreview";
import {
  WORD_SCOPED_EXPANDED_TOO_LARGE,
  wordChainedWording,
} from "./wordAuthoringContract";
import { WordDraftRepairError } from "./wordDocumentDrafts";
import { wordBlockIndex } from "./wordDocumentOutline";
import {
  assembleWordParts,
  finishWordParts,
  WORD_PARTS_REORDERING_LEFT_OUT,
  wordPartRowLabel,
  wordPartRows,
  wordPartRowTitle,
  wordPartsChangedInWord,
  wordPartsFinishRejected,
  wordPartsWithout,
} from "./wordDocumentParts";
import { WORD_NO_REQUEST_SESSION_MESSAGE } from "./wordDocumentReadTool";
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
import { wordPartsFinishChecks } from "./wordPartChecks";
import {
  WORD_LEFT_OUT_EARLIER,
  wordNotInProposalGroups,
  wordPartsNotInProposal,
  wordSubmissionBlocks,
} from "./wordPlanCoverage";
import { wordDocumentChangedRefusal } from "./wordPlanDocumentChanges";
import { wordWrittenChanges } from "./wordReadFreshness";
import {
  expandWordScopedSubmission,
  wordCompleteReadToken,
  WORD_SCOPED_TOKEN_MESSAGE,
  wordScopedIssues,
  WordScopedSubmissionError,
} from "./wordScopedSubmission";

import type { WordPartsAssembly, WordPartsDraft } from "./wordDocumentParts";
import type { WordDocumentReadSession } from "./wordDocumentReadTool";
import type { WordReadCapture } from "./wordReadFreshness";
import type { WordScopedOrigins } from "./wordScopedSubmission";
import type {
  ClientToolExecutor,
  ClientToolCallContext,
  ClientToolExecutionResult,
} from "@erato/frontend/library";
import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
  WordPlanDiagnostics,
  WordReadScope,
} from "@erato/frontend/word-review";

export { WORD_SUBMIT_PLAN_ACTION, WORD_SUBMIT_PLAN_TOOL };

type WordScopedSubmissionKind = "scoped_edit" | "table_cell";

const NEEDS_READ = [
  "too-large",
  "incomplete-read",
  "expired",
  "outside-read-scope",
  "in-place-unavailable",
];

/** Submissions and their part calls classify a refusal alike; only a read admits a recovery read. */
export const wordSubmissionRecovery = (
  issues: WordPlanDiagnostics | undefined,
): "read_current_context" | "repair_arguments" =>
  issues?.some(({ code }) => NEEDS_READ.includes(code))
    ? "read_current_context"
    : "repair_arguments";

/** The body blocks a section plan announces changing; a smaller plan accepted instead names the
 * parts it leaves out. Moves are left out, as for any refused attempt. */
function wordPartsAnnouncedBlocks(
  draft: WordPartsDraft,
  snapshot: WordAuthoringSnapshot,
): Set<number> {
  const index = wordBlockIndex(snapshot);
  return new Set(
    draft.plan.rows.flatMap((row) =>
      row.action === "keep" ? [] : row.refs.map((ref) => index.get(ref)!),
    ),
  );
}

export function createWordDocumentSubmissionExecutor(
  session: WordDocumentReadSession,
): ClientToolExecutor {
  const execute = createSubmissionExecutor(session);
  return async (input, context) => {
    const result = await execute(input, context);
    if (result.ok)
      return context ? accepted(session, result, input, context) : result;
    const snapshot = context && session.snapshotForSubmission(context);
    // A refused finish changed nothing the section plan did not announce, which acceptance names.
    if (
      context &&
      snapshot &&
      object(input) &&
      input.snapshot === snapshot.token &&
      !("finish" in input)
    )
      session.drafts.refused(
        context.toolCallId,
        wordSubmissionBlocks(
          "draft_id" in input ? session.drafts.latestDraft : input,
          snapshot,
        ),
      );
    const unavailable =
      !snapshot ||
      snapshot.revoked ||
      snapshot.used ||
      !!snapshot.issue ||
      context?.signal?.aborted;
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
            wordSubmissionRecovery(result.validationErrors)),
      },
    };
  };
}

/**
 * An accepted plan, kept for the server's apply call, with what the decision place shows for it.
 * The plan kept is the complete one the card shows, as history resolves it.
 */
function accepted(
  session: WordDocumentReadSession,
  result: ClientToolExecutionResult,
  input: unknown,
  context: ClientToolCallContext,
): ClientToolExecutionResult {
  if (!result.ok || !object(result.result) || !object(input)) return result;
  const receipt = result.result;
  const snapshot = session.snapshotForSubmission(context);
  const expanded =
    "draft_id" in input || "table_cell" in input || "scoped_edit" in input;
  const complete = expanded ? receipt.plan : input;
  if (!snapshot || !object(complete) || complete.snapshot !== snapshot.token)
    return result;
  const { [WORD_MORE_CHANGES_ARGUMENT]: _more, ...plan } = complete;
  // The stored answer holds the plan as the server wrote it back, keys sorted; the card of that
  // answer and this apply share one review only when their texts match.
  const content = JSON.stringify(sortedKeys(plan));
  const parsed = parseWordDocumentPlan(content);
  const normalized = parsed && normalizeWordDocumentPlan(parsed, snapshot);
  if (!normalized || !context.chatId) return result;
  rememberWordAcceptedPlan({
    callId: context.toolCallId,
    chatId: context.chatId,
    messageId: context.messageId,
    content,
    snapshotToken: snapshot.token,
    leftOut: Array.isArray(receipt.notInProposal)
      ? receipt.notInProposal.filter(
          (name): name is string => typeof name === "string",
        )
      : [],
  });
  return {
    ...result,
    result: {
      ...receipt,
      approval_preview: wordPlanApprovalPreview(
        normalized,
        snapshot,
        content,
        WORD_SUBMIT_PLAN_ACTION,
      ),
    },
  };
}

function sortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedKeys);
  if (!object(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortedKeys(value[key])]),
  );
}

/** A scoped_edit or finish whose snapshot or token is not this request's active read; never parsed
 * as a full plan, which would send the model to write one. */
function scopedTokenRefusal(
  snapshot: WordAuthoringSnapshot,
  input: Record<string, unknown>,
): ClientToolExecutionResult {
  const finish = "finish" in input;
  const expired =
    snapshot.revoked || snapshot.used || input.snapshot !== snapshot.token;
  const code = snapshot.issue ?? (expired ? "expired" : "incomplete-read");
  const token = finish
    ? "Use the final readToken of this request's complete read, as the section plan did."
    : WORD_SCOPED_TOKEN_MESSAGE;
  const message = snapshot.issue
    ? `This document capture is unavailable: ${snapshot.issue}.`
    : snapshot.completeReadIssue
      ? finish
        ? "This document is too large for a complete read, so it cannot be changed in parts. Change it with scoped_edit after target reads."
        : "Use an active readToken from a target read of this request; this document is too large for a complete read."
      : expired
        ? `Use this request's active snapshot. ${token}`
        : token;
  return {
    ok: false,
    error: finish ? "Document plan finish rejected." : "Scoped edit rejected.",
    validationErrors: [
      {
        path: expired || snapshot.issue ? "/snapshot" : "/readToken",
        code,
        message,
      },
    ],
  };
}

function createSubmissionExecutor(
  session: WordDocumentReadSession,
): ClientToolExecutor {
  /** An unchanged sparse change with unchanged diagnostics ends the submission turn. */
  const sparseRejection = (
    input: unknown,
    result: ClientToolExecutionResult,
  ): ClientToolExecutionResult => {
    if (
      result.ok ||
      !session.drafts.rejectSparse(input, result.validationErrors ?? [])
    )
      return result;
    return {
      ...result,
      error: "The same document proposal failed with unchanged diagnostics.",
      validationErrors: [
        {
          path: "",
          code: "no-progress",
          message:
            "The proposal and validation errors are unchanged. This submission turn has ended.",
        },
        ...(result.validationErrors ?? []),
      ].slice(0, 16),
      submissionFeedback: { ...result.submissionFeedback, terminal: true },
    };
  };
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
      return "scoped_edit" in input &&
        input.snapshot === snapshot.token &&
        wordCompleteReadToken(snapshot, input.readToken)
        ? sparseRejection(input, {
            ok: false,
            error: "Scoped edit rejected.",
            validationErrors: [
              {
                path: "/scoped_edit",
                code: "scoped-shape",
                message: wordChainedWording(WORD_SCOPED_EXPANDED_TOO_LARGE),
              },
            ],
          })
        : {
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
        return "scoped_edit" in input || "finish" in input
          ? sparseRejection(input, scopedTokenRefusal(snapshot, input))
          : prepareWordDocumentSubmission(input, context, session);
      if (session.drafts.accepted)
        return {
          ok: false,
          error: "A document plan has already been accepted for this request.",
        };
      const submitted = JSON.parse(serialized) as Record<string, unknown>;
      const finish =
        "finish" in submitted
          ? finishWordParts(submitted, snapshot, session.drafts.parts)
          : undefined;
      if (finish && !finish.ok)
        return session.drafts.remember(
          context.toolCallId,
          serialized,
          finish.result,
        );
      const checked =
        finish &&
        wordPartsFinishChecks(snapshot, finish, (r) =>
          wordPartRowTitle(finish.draft.plan.rows[r], snapshot),
        );
      if (finish && checked) finish.assembly = checked.assembly;
      // Parts the finish checks leave out stay out when Word's changes are staged.
      const staged =
        finish && checked?.leftOut.length
          ? {
              ...finish.draft,
              parts: new Map(
                [...finish.draft.parts].filter(
                  ([r]) => !checked.leftOut.includes(r),
                ),
              ),
            }
          : finish?.draft;
      let staging = staged
        ? wordPartsFinishStaging(staged, snapshot, session.capture)
        : undefined;
      if (staging && "refusal" in staging)
        return session.drafts.remember(
          context.toolCallId,
          serialized,
          staging.refusal,
        );
      if (finish && staging?.assembly) finish.assembly = staging.assembly;
      const kind: WordScopedSubmissionKind | undefined =
        "scoped_edit" in submitted
          ? "scoped_edit"
          : "table_cell" in submitted
            ? "table_cell"
            : undefined;
      // The budget check is a backend call, so only an oversized scoped_edit after a target read asks.
      const completeReadIssue =
        kind === "scoped_edit" &&
        scoped?.kind === "objects" &&
        new TextEncoder().encode(serialized).length > MAX_WORD_SCOPE_BYTES
          ? await session.completeReadIssue()
          : undefined;
      if (
        context.signal?.aborted ||
        session.snapshotForSubmission(context) !== snapshot ||
        snapshot.revoked
      )
        return { ok: false, error: "Document submission stopped." };
      const expansion =
        kind === "scoped_edit"
          ? expandWordScopedSubmission(submitted, snapshot, completeReadIssue)
          : undefined;
      let value =
        expansion?.plan ??
        (kind === "table_cell"
          ? expandWordTableCellSubmission(submitted, snapshot)
          : finish
            ? finish.assembly.plan
            : session.drafts.materialize(submitted));
      const prepare = () =>
        prepareWordDocumentSubmission(value, context, session, {
          origins: expansion?.origins,
          inPlaceOnly: !!expansion || !!finish,
        });
      // The read session may have been cleared while preparation was pending.
      const stopped = () =>
        context.signal?.aborted ||
        session.snapshotForSubmission(context) !== snapshot ||
        snapshot.revoked;
      let prepared = await prepare();
      if (stopped())
        return { ok: false, error: "Document submission stopped." };
      const redelivery = session.drafts.replay(context.toolCallId, serialized);
      if (redelivery) return redelivery;
      let changed = finish
        ? undefined
        : wordDocumentChangedRefusal(
            snapshot,
            session.capture,
            kind ? (value as WordDocumentPlan) : "document",
          );
      // Word may change a section while the finish is checked; the smaller change is checked once more.
      for (let round = 0; finish && staging && !changed; round++) {
        const later = wordPartsFinishStaging(
          staged!,
          snapshot,
          session.capture,
        );
        if (!("refusal" in later) && sameStaging(later, staging)) break;
        if ("refusal" in later || round > 0) {
          changed =
            "refusal" in later
              ? later.refusal
              : wordDocumentChangedRefusal(
                  snapshot,
                  session.capture,
                  "document",
                );
          break;
        }
        staging = later;
        if (later.assembly) finish.assembly = later.assembly;
        value = finish.assembly.plan;
        prepared = await prepare();
        if (stopped())
          return { ok: false, error: "Document submission stopped." };
      }
      if (changed)
        return session.drafts.remember(context.toolCallId, serialized, changed);
      // One refusal names what the checks found and what the pipeline refuses.
      const finishRejected =
        finish && checked && !prepared.ok
          ? wordPartsFinishRejected(
              prepared,
              { draft: finish.draft, assembly: finish.assembly },
              snapshot,
            )
          : undefined;
      if (checked?.issues.length) {
        checked.refused();
        return session.drafts.remember(
          context.toolCallId,
          serialized,
          sparseRejection(input, {
            ok: false,
            error: "Document plan finish rejected.",
            validationErrors: [
              ...checked.issues,
              ...((finishRejected?.ok === false &&
                finishRejected.validationErrors) ||
                []),
            ].slice(0, 16),
            ...(finishRejected?.ok === false &&
            finishRejected.submissionFeedback
              ? { submissionFeedback: finishRejected.submissionFeedback }
              : {}),
          }),
        );
      }
      let result = prepared;
      if (prepared.ok) {
        session.drafts.accepted = true;
        const expanded =
          "draft_id" in input ||
          "table_cell" in input ||
          "scoped_edit" in input;
        const accepted = wordSubmissionBlocks(
          kind ? submitted : value,
          snapshot,
        );
        const sectionPlan = finish ? undefined : session.drafts.parts.current;
        const changedInWord =
          staging && !("refusal" in staging)
            ? staging.changed
            : new Set<number>();
        const reorderingLeftOut =
          !!staging && !("refusal" in staging) && staging.reordering;
        const notInProposal = wordNotInProposalGroups(
          [
            {
              parts: [...changedInWord].map((r) =>
                wordPartRowLabel(finish!.draft.plan.rows[r], snapshot),
              ),
              reason:
                "which changed in Word while you were working, so the card leaves them out",
            },
            {
              parts: (finish?.unwritten ?? []).map((r) =>
                wordPartRowLabel(finish!.draft.plan.rows[r], snapshot),
              ),
              reason: "which the section plan announced but no part wrote",
            },
            {
              parts: (checked?.leftOut ?? []).map((r) =>
                wordPartRowLabel(finish!.draft.plan.rows[r], snapshot),
              ),
              reason: "whose part the finish checks refused",
            },
            {
              parts: sectionPlan
                ? wordPartsNotInProposal(
                    snapshot,
                    [wordPartsAnnouncedBlocks(sectionPlan, snapshot)],
                    accepted,
                  )
                : [],
              reason: "which the section plan of this request announced",
            },
            {
              parts: wordPartsNotInProposal(
                snapshot,
                session.drafts.refusedAttempts,
                accepted,
              ),
              reason: WORD_LEFT_OUT_EARLIER,
            },
          ],
          reorderingLeftOut ? WORD_PARTS_REORDERING_NOTE : undefined,
        );
        if (expanded || notInProposal)
          result = {
            ...prepared,
            result: {
              ...(prepared.result as object),
              ...(expanded ? { plan: value } : {}),
              ...(finish
                ? {
                    rows: wordPartRows(finish.draft, snapshot, {
                      finished: true,
                      changed: changedInWord,
                      leftOut: checked?.leftOut,
                    }),
                  }
                : {}),
              ...(reorderingLeftOut
                ? { reordering: WORD_PARTS_REORDERING_LEFT_OUT }
                : {}),
              ...notInProposal,
            },
          };
      } else if (finishRejected) {
        result = sparseRejection(input, finishRejected);
      } else if (kind === "scoped_edit") {
        // A sparse change is corrected by resubmitting it, never by patching the
        // expanded plan the model never saw.
        result = sparseRejection(input, prepared);
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
        validationErrors:
          error instanceof WordScopedSubmissionError && error.issues?.length
            ? error.issues.slice(0, 16)
            : [{ path: error.path, code: error.code, message: error.message }],
      };
      return error.code === "call-conflict"
        ? failure
        : session.drafts.remember(
            context.toolCallId,
            serialized,
            "scoped_edit" in input ? sparseRejection(input, failure) : failure,
          );
    }
  };
}

const WORD_PARTS_REORDERING_NOTE =
  "The reordering is left out: the document changed in Word while you were working, and reordering replaces the whole document.";

type WordPartsFinishStaging =
  | {
      /** Rows (from 0) left out because Word changed what they write. */
      changed: Set<number>;
      reordering: boolean;
      /** What the finish stages once the document changed. */
      assembly?: WordPartsAssembly;
    }
  | { refusal: ClientToolExecutionResult };

const sameStaging = (
  a: Extract<WordPartsFinishStaging, { changed: unknown }>,
  b: Extract<WordPartsFinishStaging, { changed: unknown }>,
) => a.changed.size === b.changed.size && a.reordering === b.reordering;

/** Whether Apply would replace the whole document for `plan`; undefined when it cannot compile,
 * which preparation then reports. */
function wordPlanReplacesDocument(
  plan: WordDocumentPlan,
  snapshot: WordAuthoringSnapshot,
): boolean | undefined {
  try {
    const normalized = normalizeWordDocumentPlan(plan, snapshot);
    const compiled = captureWordAuthoringSnapshot(
      compileWordDocumentPlan(normalized, snapshot),
      snapshot.identity,
      "Off",
      snapshot.fullDocument,
      "verify",
    );
    if (compiled.issue) return undefined;
    return (
      routeWordDocumentPlan(
        normalized,
        snapshot,
        wordInPlaceAvailability(),
        wordInPlaceCapabilitiesUnder(snapshot.trackingMode),
        compiled,
      ).route !== "in-place"
    );
  } catch {
    return undefined;
  }
}

/**
 * What a finish stages once the document changed in Word since the capture. A row whose written
 * blocks changed is left out on its own. Apply refuses to replace a document that changed at all,
 * so a rest that would still replace it leaves out the reordering too, and is refused as before
 * when even that cannot go in place.
 */
function wordPartsFinishStaging(
  draft: WordPartsDraft,
  snapshot: WordAuthoringSnapshot,
  capture: WordReadCapture | undefined,
): WordPartsFinishStaging {
  const changed = wordPartsChangedInWord(draft, snapshot, capture);
  if (!wordWrittenChanges(snapshot, capture, "document"))
    return { changed, reordering: false };
  const assemble = (structure: boolean) => {
    const { plan, parts } = wordPartsWithout(
      draft.plan,
      draft.parts,
      { rows: changed, structure },
      snapshot,
    );
    return assembleWordParts(snapshot, draft.readToken, plan, parts);
  };
  const rest = assemble(false);
  if (wordPlanReplacesDocument(rest.plan, snapshot) !== true)
    return { changed, reordering: false, assembly: rest };
  const inPlace = assemble(true);
  if (wordPlanReplacesDocument(inPlace.plan, snapshot) === false)
    return { changed, reordering: true, assembly: inPlace };
  return {
    refusal: wordDocumentChangedRefusal(snapshot, capture, "document")!,
  };
}

/** `origins` is set for a sparse change; its diagnostics then point at that change. `inPlaceOnly`
 * refuses, as for a sparse change, what a host that never imports the whole document cannot apply. */
export async function prepareWordDocumentSubmission(
  input: unknown,
  context: ClientToolCallContext | undefined,
  session: WordDocumentReadSession,
  {
    origins,
    inPlaceOnly = !!origins,
  }: { origins?: WordScopedOrigins; inPlaceOnly?: boolean } = {},
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
          message: WORD_NO_REQUEST_SESSION_MESSAGE,
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
      validationErrors: origins ? wordScopedIssues(issues, origins) : issues,
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
    const wholeDocument = scopedWholeDocumentReasons(
      plan,
      snapshot,
      prepared,
      inPlaceOnly,
    );
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
  /** The read scope the plan came from; undefined after a complete read. */
  scope?: WordReadScope["kind"];
}

/**
 * Apply never lets a plan from a scoped read replace the whole document unless the host's policy
 * allows that outright, so such a plan the in-place writer cannot take is refused here, where the
 * model can still resubmit, rather than on the card. A sparse change after a complete read has a
 * full plan's rights, so it is refused here only where the host never replaces the whole document.
 */
function scopedWholeDocumentReasons(
  plan: WordDocumentPlan,
  snapshot: WordAuthoringSnapshot,
  prepared: WordAuthoringSnapshot,
  sparse: boolean,
): WordScopedWholeDocument | undefined {
  const policy = wordApplyPolicy().wholeDocumentImport;
  const scope = wordPlanReadScope(plan, snapshot);
  if (policy === "allowed" || (!scope && !(sparse && policy === "off")))
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
    return { reasons: ["no-package"], hostWide: true, scope };
  if (!availability.enabled)
    return { reasons: [availability.reason], hostWide: true, scope };
  let reasons: string[] = [];
  try {
    reasons = wordInPlaceFallbacks(plan, snapshot, caps, prepared);
  } catch {
    // The route already read the classifier failure as program-mismatch.
  }
  return {
    reasons: reasons.length ? reasons : [route.reason],
    hostWide: false,
    scope,
  };
}

/** Where nothing can be written in place, a smaller scoped edit cannot help; under `confirm` a full
 * plan still reaches the card's confirmation. */
function scopedWholeDocumentRefusal(
  { reasons, hostWide, scope }: WordScopedWholeDocument,
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
    ? `${host} writes ${scope ? "edits from a scoped read" : "edits"} only in place, and this edit needs a full-document rewrite ${because} Resubmit only edits that can be written in place, such as rewording existing paragraphs, headings, list items or table cells, or tell the user that this change ${web ? "needs Word for Windows or Mac" : "can't be made in this version of Word"}.`
    : `${host} can't write any edit in place right now ${because} ${scope ? "An edit from a scoped read" : "This host"} never replaces the whole document, so ${
        fullPlan
          ? `complete the full read and resubmit the same ${scope === "table-cell" ? "table_cell change" : "scoped_edit"} with its final readToken; the user is asked to confirm before it replaces the whole document.`
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
