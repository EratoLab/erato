import { editExcerpt, parseWordEdits } from "@erato/frontend/word-review";

import { WORD_APPLY_BUSY_WAIT_MS } from "./wordApplyCall";
import { WORD_CLIENT_ACTIONS } from "./wordClientActions";
import { wordCommentTaintedMessage } from "./wordCommentReadTool";
import { beginWithin } from "./wordPlanApply";
import { readWordTrackingMode } from "./wordReviewLocation";
import { wordWriteBridge } from "./wordWriteBridge";
import { resolveWordWriteGate } from "./wordWriteGate";
import {
  answerFences,
  proposalOnceByCallId,
  sameItem,
  USER_PICKS,
} from "../../core/clientActions/proposalApply";
import { wordSelectionStore } from "../hooks/wordSelectionStore";

import type { WordClientAction } from "./wordClientActions";
import type { WordCommentsCapture } from "./wordCommentSend";
import type { WordReplaceSelectionResult } from "./wordReplaceSelection";
import type { WordReviewState } from "./wordReviewState";
import type { WordWriteBridge } from "./wordWriteBridge";
import type { ProposalApplyResult } from "../../core/clientActions/proposalApply";
import type { ClientToolExecutor } from "@erato/frontend/library";
import type { WordDocumentCapture } from "@erato/frontend/word-review";

export type WordProposalAction =
  | "word.replace_selection"
  | "word.insert_at_cursor"
  | "word.apply_edits";

/** The server's tools for Word's proposed actions, by the action each carries out. */
export const WORD_PROPOSAL_TOOLS: Readonly<Record<WordProposalAction, string>> =
  {
    "word.replace_selection": "replace_selection",
    "word.insert_at_cursor": "insert_at_cursor",
    "word.apply_edits": "apply_edits",
  };

export const wordProposalActionOf = (
  tool: string,
): WordProposalAction | undefined =>
  (Object.keys(WORD_PROPOSAL_TOOLS) as WordProposalAction[]).find(
    (action) => WORD_PROPOSAL_TOOLS[action] === tool,
  );

/** The review a selection Replace leaves its card in. */
export function wordSelectionReviewStatus(
  result: WordReplaceSelectionResult,
): WordReviewState["status"] {
  switch (result.status) {
    case "applied":
    case "unchanged":
      return "done";
    case "unverified":
      return "write-failed";
    default:
      return "error";
  }
}

/** The key of the card that shows this change in the answer, so both share one review. */
export const wordProposalReviewKey = (
  messageId: string,
  action: WordClientAction,
  content: string,
) => `${messageId}:${action}:${content}`;

/** Whether the request carried other people's comment text, which never writes unasked. */
const commentTainted = (capture: WordDocumentCapture, messageId: string) =>
  !!(capture as WordCommentsCapture).commentTaint ||
  wordCommentTaintedMessage(messageId);

/**
 * The server's call for a proposed Word action: it writes the answer's text as the card's own
 * Apply does, on the copy taken when the request was sent, and only into the document the answer
 * was made for. The card in the answer shows the same review.
 */
export function createWordProposalExecutor(
  tool: string,
  bridge: () => WordWriteBridge | null = wordWriteBridge,
): ClientToolExecutor {
  return proposalOnceByCallId(
    async (input, context, writeStarts): Promise<ProposalApplyResult> => {
      const action = wordProposalActionOf(tool);
      if (!action || input.action !== action)
        return { status: "failed", reason: "invalid_input" };
      const host = bridge();
      if (!host) return { status: "unavailable", reason: "no_pane" };
      const message = host.messageContext(context.messageId);
      if (!message.content)
        return { status: "unavailable", reason: "no_message" };
      if (!message.latest)
        return { status: "unavailable", reason: "not_latest" };
      const expected = input.itemIdentity ?? message.identity;
      const current = host.documentIdentity();
      if (!sameItem(expected, current))
        return { status: "unavailable", reason: "other_item" };
      const entry = WORD_CLIENT_ACTIONS.get(action)!;
      const fences = answerFences(message.content).filter(
        (fence) => fence.language === entry.fenceLanguage,
      );
      const reviewOf = (body: string) =>
        host.reviewFor(wordProposalReviewKey(context.messageId, action, body))
          ?.status;
      // The user already ran it, or one of its versions, from the card in the answer.
      if (fences.some((fence) => reviewOf(fence.body) === "done"))
        return { status: "applied", reason: "already_applied" };
      if (fences.length > 1)
        return { status: "unavailable", reason: USER_PICKS };
      if (!fences.length) return { status: "failed", reason: "not_found" };
      const content = fences[0].body;
      const gate = resolveWordWriteGate({
        capture: host.captureFor(context.messageId),
        expectedIdentity: expected!,
        currentIdentity: current,
      });
      if (!gate.allowed)
        return {
          status: "unavailable",
          reason: gate.reason === "no-capture" ? "capture_lost" : "other_item",
        };
      const { capture } = gate;
      if (
        action === "word.replace_selection" &&
        commentTainted(capture, context.messageId) &&
        input.confirmation.confirmed !== true
      )
        return { status: "needs_decision", reason: "comment_text" };
      const key = wordProposalReviewKey(context.messageId, action, content);
      const before = reviewOf(content);
      if (before === "applying" || before === "reverting")
        return { status: "failed", reason: "busy" };
      // An insert has no passage to check again, so one the card tried may already be there.
      if (
        action === "word.insert_at_cursor" &&
        (before === "write-failed" || before === "error")
      )
        return { status: "unconfirmed", reason: "already_attempted" };
      if (context.signal?.aborted)
        return { status: "failed", reason: "stopped" };
      if (!(await beginWithin(host, WORD_APPLY_BUSY_WAIT_MS)))
        return { status: "failed", reason: "busy" };
      if (context.signal?.aborted) {
        host.endOperation();
        return { status: "failed", reason: "stopped" };
      }
      let held = false;
      try {
        const tracking =
          action === "word.apply_edits" ? await readWordTrackingMode() : "off";
        // Under Track Changes a paragraph Replace would land as one whole-paragraph revision.
        if (
          action === "word.apply_edits" &&
          (capture.trackChanges || tracking === "on")
        )
          return { status: "failed", reason: "track_changes" };
        host.updateReview(key, {
          status: "applying",
          applyStage: "checking",
          capture,
        });
        writeStarts();
        const run = await entry
          .execute({
            fenceContent: content,
            capture,
            onStage: (applyStage) => host.updateReview(key, { applyStage }),
          })
          .catch(() => undefined);
        if (!run) {
          const edits =
            action === "word.apply_edits" ? parseWordEdits(content) : null;
          host.updateReview(key, {
            applyStage: undefined,
            status: "write-failed",
            outcomes: (edits ?? []).map((edit, index) => ({
              ...edit,
              index,
              status: "failed" as const,
              excerpt: editExcerpt(edit.text),
            })),
          });
          return { status: "unconfirmed", reason: "host_error" };
        }
        if (action === "word.replace_selection") {
          const outcome = run.selectionResult;
          if (!outcome) {
            host.updateReview(key, { status: "error", applyStage: undefined });
            return { status: "failed", reason: "host_error" };
          }
          if (
            (outcome.status === "failed" || outcome.status === "unverified") &&
            outcome.timedOut
          ) {
            held = true;
            host.holdOperationUntil(outcome.settled, key);
          }
          if (
            outcome.status === "unverified" ||
            (outcome.status === "applied" && !outcome.backups?.length)
          )
            host.setRevertSlot(null);
          if (outcome.status === "applied") {
            if (outcome.backups?.length)
              host.setRevertSlot({
                messageId: context.messageId,
                batchKey: key,
                identity: capture.identity,
                ooxml: outcome.backups[0].ooxml,
                selection: {
                  written: outcome.written,
                  backups: outcome.backups,
                },
              });
            wordSelectionStore.requestRefresh();
          }
          host.updateReview(key, {
            status: wordSelectionReviewStatus(outcome),
            applyStage: undefined,
            detailsExpanded: false,
            selection: outcome,
            tracking:
              outcome.status === "applied" && outcome.trackingOn ? "on" : "off",
          });
          switch (outcome.status) {
            case "applied":
            case "unchanged":
              return { status: "applied" };
            case "refused":
              return { status: "failed", reason: outcome.code };
            case "unverified":
              return { status: "unconfirmed", reason: "unverified" };
            default:
              return outcome.timedOut
                ? { status: "unconfirmed", reason: "timed_out" }
                : { status: "failed", reason: "host_error" };
          }
        }
        if (run.snapshotOoxml)
          host.setRevertSlot({
            messageId: context.messageId,
            batchKey: key,
            identity: capture.identity,
            ooxml: run.snapshotOoxml,
            afterFingerprint: run.afterFingerprint,
          });
        // An earlier Undo would restore a body without this insert, so the single slot ends here.
        else if (action === "word.insert_at_cursor" && run.ok)
          host.setRevertSlot(null);
        const edits = action === "word.apply_edits";
        host.updateReview(key, {
          applyStage: undefined,
          detailsExpanded: false,
          status:
            run.ok || (edits && run.hostFailed === false)
              ? "done"
              : run.snapshotOoxml
                ? "write-failed"
                : "error",
          outcomes: run.outcomes,
          anchors: run.resultAnchors,
          locationGeneration: host.locationGeneration(),
          tracking,
        });
        if (run.ok) return { status: "applied" };
        return {
          status: "failed",
          reason:
            edits && run.hostFailed === false
              ? "nothing_applied"
              : "host_error",
        };
      } finally {
        if (!held) host.endOperation();
      }
    },
  );
}
