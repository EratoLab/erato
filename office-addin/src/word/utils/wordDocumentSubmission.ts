import {
  parseWordDocumentPlan,
  validateWordDocumentPlan,
} from "./wordDocumentPlan";
import {
  captureWordAuthoringSnapshot,
  compileWordDocumentPlan,
  verifyWordPlanOutput,
} from "./wordDocumentXml";

import type { WordDocumentReadSession } from "./wordDocumentReadTool";
import type { WordPlanDiagnostics } from "./wordPlanDiagnostics";
import type { ClientToolExecutor, ContentPart } from "@erato/frontend/library";

export const WORD_SUBMIT_PLAN_TOOL = "submit_document_plan";
export const WORD_SUBMIT_PLAN_ACTION = "word.apply_document_plan";

/** Validate and prepare against an immutable capture. No Office.js or writes. */
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
    const plan = parseWordDocumentPlan(content, issues);
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
      // Only known fixed compiler diagnostics can cross the tool boundary.
      // Never return raw errors, document XML, host details or artifact copies.
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
    // Deterministic by tool-call ID. The backend persists the original input
    // and this receipt; a result-POST retry does not create another draft.
    return {
      ok: true,
      result: {
        draft_id: context.toolCallId,
        snapshot: plan.snapshot,
        action: WORD_SUBMIT_PLAN_ACTION,
      },
    };
  };
}

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Restore only one server-accepted submission, never pending/failed drafts. */
export function acceptedWordDocumentSubmission(
  content: ContentPart[] | undefined,
): { toolCallId: string; content: string } | undefined {
  const accepted = (content ?? []).filter((part) => {
    if (
      part.content_type !== "tool_use" ||
      part.tool_name !== WORD_SUBMIT_PLAN_TOOL ||
      part.status !== "success" ||
      typeof part.tool_call_id !== "string" ||
      !part.tool_call_id
    )
      return false;
    const output = part.output;
    if (
      !object(output) ||
      output.status !== "success" ||
      !object(output.submission) ||
      output.submission.status !== "accepted" ||
      !object(output.result) ||
      !object(part.input)
    )
      return false;
    return (
      output.result.draft_id === part.tool_call_id &&
      output.result.snapshot === part.input.snapshot &&
      output.result.action === WORD_SUBMIT_PLAN_ACTION
    );
  });
  if (accepted.length !== 1) return undefined;
  const part = accepted[0];
  if (part.content_type !== "tool_use" || !part.tool_call_id) return undefined;
  const contentJson = JSON.stringify(part.input);
  if (!parseWordDocumentPlan(contentJson)) return undefined;
  return { toolCallId: part.tool_call_id, content: contentJson };
}
