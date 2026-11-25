import { t } from "@lingui/core/macro";

import { chainedCallId } from "../../core/clientActions/chainedCall";

import type { WordApplyCallResult, WordApplyStatus } from "./wordApplyCall";
import type { ChainedCallState } from "../../core/clientActions/chainedCall";
import type { ContentPart } from "@erato/frontend/library";

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Whether the user cancelled the server's apply call for an accepted submission or asked for a
 * different change: nothing was written, and the same request may submit again.
 */
export function wordChainedApplyDeclined(
  content: readonly ContentPart[] | undefined,
  submissionCallId: string | undefined,
): boolean {
  const applyCallId = chainedCallId(content, submissionCallId);
  const part = applyCallId
    ? (content ?? []).find(
        (candidate) =>
          candidate.content_type === "tool_use" &&
          candidate.tool_call_id === applyCallId,
      )
    : undefined;
  if (part?.content_type !== "tool_use" || part.status !== "error")
    return false;
  const output: unknown = part.output;
  const status = object(output) ? output.status : undefined;
  return status === "rejected" || status === "change_requested";
}

export type WordChainedApplyState = ChainedCallState<WordApplyCallResult>;

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

function wordChainedResultText(result: {
  status: WordApplyStatus;
  reason?: string;
}): string {
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
