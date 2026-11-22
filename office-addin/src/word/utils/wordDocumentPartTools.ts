import { MAX_PLAN_BYTES } from "@erato/frontend/word-review";

import { WordDraftRepairError } from "./wordDocumentDrafts";
import {
  assembleWordParts,
  parseWordPartOps,
  parseWordPartsPlan,
  wordPartIssues,
  wordPartRowName,
  wordPartRows,
  wordPartRowTitle,
  wordUnwrittenRows,
} from "./wordDocumentParts";
import {
  captureUnavailable,
  WORD_NO_REQUEST_SESSION_MESSAGE,
} from "./wordDocumentReadTool";
import {
  prepareWordDocumentSubmission,
  wordSubmissionRecovery,
} from "./wordDocumentSubmission";
import {
  checkWordPart,
  parseWordPartAllow,
  wordPartsUncoveredSections,
} from "./wordPartChecks";
import { wordCompleteReadToken } from "./wordScopedSubmission";

import type { WordPartsAssembly, WordPartsDraft } from "./wordDocumentParts";
import type { WordDocumentReadSession } from "./wordDocumentReadTool";
import type {
  ClientToolCallContext,
  ClientToolExecutionResult,
  ClientToolExecutor,
} from "@erato/frontend/library";
import type {
  WordAuthoringSnapshot,
  WordPlanDiagnostics,
} from "@erato/frontend/word-review";

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const FINISH_CALL =
  "submit_document_plan {snapshot, readToken, draft_id, revision, finish:true}";

const refuse = (
  issues: WordPlanDiagnostics,
  error = "Document part rejected.",
): ClientToolExecutionResult => ({
  ok: false,
  error,
  validationErrors: issues.slice(0, 16),
});

const refusal = (path: string, code: string, message: string) =>
  refuse([{ path, code, message }]);

type Step = (
  input: Record<string, unknown>,
  snapshot: WordAuthoringSnapshot,
  context: ClientToolCallContext,
) => Promise<ClientToolExecutionResult>;

/** A refusal always carries diagnostics, since the backend ends the step on a bare error; a part
 * is no attempt, so only a capture that is gone ends the step here. */
function partExecutor(
  session: WordDocumentReadSession,
  step: Step,
): ClientToolExecutor {
  return async (input, context) => {
    if (!context || context.signal?.aborted)
      return { ...captureUnavailable(), error: "Document part stopped." };
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
        submissionFeedback: { terminal: true, recovery: "cannot_continue" },
      };
    if (snapshot.revoked || snapshot.used || snapshot.issue)
      return captureUnavailable();
    if (!object(input))
      return refusal("", "part-shape", "Expected JSON arguments.");
    const serialized = JSON.stringify(input);
    let result: ClientToolExecutionResult;
    try {
      const previous = session.drafts.replay(context.toolCallId, serialized);
      if (previous) return previous;
    } catch (error) {
      if (!(error instanceof WordDraftRepairError)) throw error;
      return refusal(error.path, error.code, error.message);
    }
    if (session.drafts.accepted)
      result = refusal(
        "",
        "submission-unavailable",
        "A document plan has already been accepted for this request.",
      );
    else if (input.snapshot !== snapshot.token)
      result = refusal(
        "/snapshot",
        "expired",
        "Use this request's active snapshot.",
      );
    else result = await step(input, snapshot, context);
    if (
      context.signal?.aborted ||
      session.snapshotForSubmission(context) !== snapshot ||
      snapshot.revoked
    )
      return { ...captureUnavailable(), error: "Document part stopped." };
    if (!result.ok)
      result = {
        ...result,
        submissionFeedback: {
          terminal: false,
          recovery: wordSubmissionRecovery(result.validationErrors),
        },
      };
    return session.drafts.remember(context.toolCallId, serialized, result);
  };
}

async function check(
  assembly: WordPartsAssembly,
  focus: Parameters<typeof wordPartIssues>[2],
  draftPlan: WordPartsDraft["plan"],
  snapshot: WordAuthoringSnapshot,
  context: ClientToolCallContext,
  session: WordDocumentReadSession,
): Promise<ClientToolExecutionResult | undefined> {
  // Checked as a sparse change is: a host that never imports the whole document refuses a part
  // that needs it now, not on the card after every part is written.
  const prepared = await prepareWordDocumentSubmission(
    assembly.plan,
    context,
    session,
    { inPlaceOnly: true },
  );
  if (prepared.ok) return undefined;
  const issues = prepared.validationErrors?.length
    ? prepared.validationErrors
    : [{ path: "", code: "part-rejected", message: prepared.error }];
  return refuse(
    wordPartIssues(
      issues.map((issue) =>
        issue.code === "too-large" && !issue.path
          ? {
              ...issue,
              message: `With this ${focus.kind === "plan" ? "section plan" : "part"}, the whole change exceeds the ${MAX_PLAN_BYTES / 1024} KiB plan limit; keep more blocks by reference, or leave part of the change for the next request.`,
            }
          : issue,
      ),
      assembly,
      focus,
      (r) => wordPartRowTitle(draftPlan.rows[r], snapshot),
    ),
    focus.kind === "plan"
      ? "Section plan rejected."
      : "Document part rejected.",
  );
}

const nextStep = (draft: WordPartsDraft) => {
  const left = wordUnwrittenRows(draft);
  return {
    rows_left: left.map((r) => r + 1),
    next: left.length
      ? `Write row ${left[0] + 1} with write_document_section.`
      : `Every rewrite row is written: finish with ${FINISH_CALL}.`,
  };
};

function planStep(session: WordDocumentReadSession): Step {
  return async (input, snapshot, context) => {
    if (!wordCompleteReadToken(snapshot, input.readToken))
      return snapshot.completeReadIssue
        ? refusal(
            "/readToken",
            "too-large",
            "This document is too large for a complete read, so it cannot be changed in parts. Change it with scoped_edit after target reads.",
          )
        : refusal(
            "/readToken",
            "incomplete-read",
            "A section plan needs the complete read: call read_document_blocks with the snapshot and no target, follow nextCursor until complete=true, then send the plan with that final readToken.",
          );
    const parsed = parseWordPartsPlan(input, snapshot);
    if ("issues" in parsed)
      return refuse(parsed.issues, "Section plan rejected.");
    const readToken = input.readToken as string;
    const assembly = assembleWordParts(
      snapshot,
      readToken,
      parsed.plan,
      session.drafts.parts.carried(parsed.plan),
    );
    const refused = await check(
      assembly,
      { kind: "plan" },
      parsed.plan,
      snapshot,
      context,
      session,
    );
    if (refused) return refused;
    const store = session.drafts.parts;
    const draft = store.open(parsed.plan, readToken);
    const rows = wordPartRows(draft, snapshot);
    const first = rows.find((row) => row.status === "waiting");
    const uncovered = wordPartsUncoveredSections(
      snapshot,
      parsed.plan,
      session.request,
    )
      .filter(({ entry }) => !store.namedSections.has(entry))
      .slice(0, 5);
    for (const { entry } of uncovered) store.namedSections.add(entry);
    return {
      ok: true,
      result: {
        draft_id: draft.id,
        revision: draft.revision,
        rows,
        next_row: first?.row ?? null,
        next: first
          ? `Write row ${first.row} with write_document_section.`
          : `No row needs a part: finish with ${FINISH_CALL}.`,
        ...(uncovered.length
          ? {
              fix_requests: uncovered.map(({ title }) => ({
                title,
                issues: [
                  {
                    code: "section-not-covered",
                    message: `The request names ${title}, and no row of this section plan changes it. If the request asks to change it, send the section plan again with a rewrite row for it; if it names it only for context, go on.`,
                  },
                ],
              })),
            }
          : {}),
      },
    };
  };
}

function writeStep(session: WordDocumentReadSession): Step {
  return async (input, snapshot, context) => {
    const draft = session.drafts.parts.current;
    const unknown = Object.keys(input).find(
      (key) => !["snapshot", "draft_id", "row", "ops", "allow"].includes(key),
    );
    if (unknown !== undefined)
      return refusal(
        "",
        "part-shape",
        `A part has snapshot, draft_id, row, ops and allow only; remove "${unknown.slice(0, 40)}".`,
      );
    const allowed = parseWordPartAllow(input.allow);
    if ("message" in allowed)
      return refusal("/allow", "part-shape", allowed.message);
    if (!draft || input.draft_id !== draft.id)
      return refusal(
        "/draft_id",
        "draft-unknown",
        draft
          ? "Use the draft_id of this request's section plan receipt."
          : "Send plan_document_sections first; a part belongs to a row of the section plan.",
      );
    const rows = draft.plan.rows;
    const row = input.row;
    if (
      typeof row !== "number" ||
      !Number.isInteger(row) ||
      row < 1 ||
      row > rows.length
    )
      return refusal(
        "/row",
        "row-number",
        `row is the number of a rewrite row of the section plan, 1–${rows.length}.`,
      );
    const r = row - 1;
    const planRow = rows[r];
    if (planRow.action !== "rewrite")
      return refusal(
        "/row",
        "row-action",
        `${wordPartRowName(r, wordPartRowTitle(planRow, snapshot))} is a ${planRow.action} row, and only rewrite rows take a part. To change it, send the section plan again with it as a rewrite row.`,
      );
    const parsed = parseWordPartOps(input.ops, r, planRow, snapshot);
    if ("issues" in parsed) return refuse(parsed.issues);
    const plan = draft.plan;
    const assembly = assembleWordParts(
      snapshot,
      draft.readToken,
      plan,
      new Map([...draft.parts, [r, parsed.ops]]),
    );
    const slips = assembly.textIssues.get(r);
    if (slips) return refuse(slips);
    const checked = checkWordPart({
      snapshot,
      plan,
      row: r,
      ops: parsed.ops,
      assembly,
      allow: allowed.allow,
    });
    // The shipping checks run too, so one refusal names everything the part must fix.
    const refused = await check(
      assembly,
      { kind: "part", row: r },
      plan,
      snapshot,
      context,
      session,
    );
    if (checked.issues.length || refused)
      return refuse([
        ...checked.issues,
        ...((refused && !refused.ok && refused.validationErrors) || []),
      ]);
    if (session.drafts.parts.current !== draft || draft.plan !== plan)
      return refusal(
        "/draft_id",
        "draft-revision",
        "The section plan changed while this part was checked; send the part again for the new plan's row.",
      );
    session.drafts.parts.write(draft, r, parsed.ops, {
      allow: allowed.allow,
      waived: checked.waived,
    });
    const after = assembly.plan.entries.reduce(
      (count, entry, k) =>
        assembly.entries[k].row !== r
          ? count
          : count +
            (entry.kind === "keep" ? entry.source.length : entry.blocks.length),
      0,
    );
    return {
      ok: true,
      result: {
        draft_id: draft.id,
        revision: draft.revision,
        row,
        status: "ready",
        paragraphs: { before: planRow.refs.length, after },
        ...(checked.waived.length ? { allowed: checked.waived } : {}),
        ...nextStep(draft),
      },
    };
  };
}

export function createWordDocumentPartExecutors(
  session: WordDocumentReadSession,
): { plan: ClientToolExecutor; write: ClientToolExecutor } {
  // One call at a time, so each part is checked on a draft that holds every part stored before it.
  let queue: Promise<unknown> = Promise.resolve();
  const inTurn =
    (executor: ClientToolExecutor): ClientToolExecutor =>
    (input, context) => {
      const run = queue.then(() => executor(input, context));
      queue = run.catch(() => undefined);
      return run;
    };
  return {
    plan: inTurn(partExecutor(session, planStep(session))),
    write: inTurn(partExecutor(session, writeStep(session))),
  };
}
