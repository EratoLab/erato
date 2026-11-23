import { t } from "@lingui/core/macro";

import type { WordApplyCallResult } from "./wordApplyCall";
import type { ContentPart } from "@erato/frontend/library";

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The server's apply call for an accepted submission, when the server chained one. */
export function wordChainedApplyCallId(
  content: readonly ContentPart[] | undefined,
  submissionCallId: string | undefined,
): string | undefined {
  if (!submissionCallId) return undefined;
  const part = (content ?? []).find(
    (candidate) =>
      candidate.content_type === "tool_use" &&
      candidate.tool_call_id === submissionCallId,
  );
  if (part?.content_type !== "tool_use" || !object(part.output))
    return undefined;
  const apply = part.output.apply;
  return object(apply) && typeof apply.call_id === "string"
    ? apply.call_id
    : undefined;
}

export type WordChainedApplyState =
  | { kind: "waiting" }
  | { kind: "applying" }
  | { kind: "cancelled" }
  | { kind: "done"; result: WordApplyCallResult };

/** Where the server's apply call stands, as the stored answer has it. */
export function wordChainedApplyState(
  content: readonly ContentPart[] | undefined,
  applyCallId: string,
): WordChainedApplyState {
  const part = (content ?? []).find(
    (candidate) =>
      candidate.content_type === "tool_use" &&
      candidate.tool_call_id === applyCallId,
  );
  if (part?.content_type !== "tool_use") return { kind: "waiting" };
  const raw: unknown = part.output;
  const output = object(raw) ? raw : undefined;
  if (output?.status === "rejected") return { kind: "cancelled" };
  const result = output?.result;
  if (part.status === "success" && object(result))
    return { kind: "done", result: result as unknown as WordApplyCallResult };
  if (part.status === "error")
    return { kind: "done", result: { status: "failed" } };
  return { kind: "applying" };
}

/** One line for a chained change in the answer, where the pane holds no review of it. */
export function wordChainedApplyText(state: WordChainedApplyState): string {
  switch (state.kind) {
    case "waiting":
      return t({
        id: "officeAddin.word.chained.waiting",
        message: "Waiting for your decision",
      });
    case "applying":
      return t({
        id: "officeAddin.word.chained.applying",
        message: "Applying the change…",
      });
    case "cancelled":
      return t({
        id: "officeAddin.word.chained.cancelled",
        message: "Cancelled. Nothing was changed.",
      });
    case "done":
      return wordChainedResultText(state.result);
  }
}

function wordChainedResultText(result: WordApplyCallResult): string {
  switch (result.status) {
    case "applied":
      return t({ id: "officeAddin.word.chained.applied", message: "Applied." });
    case "partial":
      return t({
        id: "officeAddin.word.chained.partial",
        message: "Partly applied. Erato checks the document again.",
      });
    case "unconfirmed":
      return t({
        id: "officeAddin.word.chained.unconfirmed",
        message:
          "The change may already be in the document. Erato reads it again before going on.",
      });
    case "stale":
      return t({
        id: "officeAddin.word.chained.stale",
        message:
          "Not changed: the document has to be read again before this change can be made.",
      });
    case "unavailable":
      return result.reason === "pane_gone"
        ? t({
            id: "officeAddin.word.chained.paneGone",
            message: "Not changed: the Erato pane was closed.",
          })
        : result.reason === "other_document"
          ? t({
              id: "officeAddin.word.chained.otherDocument",
              message:
                "Not changed: another document is open in Word than the one this change was made for.",
            })
          : t({
              id: "officeAddin.word.chained.notChanged",
              message: "Not changed.",
            });
    case "needs_decision":
      return t({
        id: "officeAddin.word.chained.onScreen",
        message: "Waiting for your decision on screen",
      });
    case "failed":
      return result.reason === "stopped"
        ? t({
            id: "officeAddin.word.chained.stopped",
            message: "Stopped. Nothing was changed.",
          })
        : t({
            id: "officeAddin.word.chained.notChanged",
            message: "Not changed.",
          });
  }
}
