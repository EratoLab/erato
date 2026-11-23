import {
  onceByCallId,
  WORD_APPLY_BUSY_WAIT_MS,
  wordApplyAnswer,
  wordLostCaptureAnswer,
  wordReplayedApply,
} from "./wordApplyCall";
import {
  markWordApplyDone,
  markWordApplyWriting,
} from "./wordApplyCallMarkers";
import { WORD_CLIENT_ACTIONS } from "./wordClientActions";
import {
  recordWordCommentOutcome,
  wordCommentAlwaysBlock,
  wordCommentAuthorPlan,
  wordCommentCardMode,
  wordCommentOutcomeRecord,
} from "./wordCommentCard";
import { wordCommentDeploymentSettings } from "./wordCommentPolicy";
import { wordCommentTaintedMessage } from "./wordCommentReadTool";
import {
  wordCommentDraft,
  wordCommentProposalApplied,
} from "./wordCommentSubmission";
import { wordDocumentReadSession } from "./wordDocumentReadTool";
import { readWordTrackingMode } from "./wordReviewLocation";
import { wordPrincipalName, wordWriteBridge } from "./wordWriteBridge";

import type { WordApplyCallResult } from "./wordApplyCall";
import type { WordCommentRowResult } from "./wordCommentWrites";
import type { WordDocumentReadSession } from "./wordDocumentReadTool";
import type { WordWriteBridge } from "./wordWriteBridge";
import type { ClientToolExecutor } from "@erato/frontend/library";
import type { WordDocumentCapture } from "@erato/frontend/word-review";

/** The rows the user kept on the decision-place card; all of them when absent. */
export interface WordCommentConfirmation {
  selected?: number[];
}

/** A run that outlived its timeout keeps every Word card waiting this long at most. */
const SETTLE_CEILING_MS = 60_000;

const applied = (row: WordCommentRowResult) =>
  row.status === "applied" || row.status === "applied_as_user";

/**
 * The server's call that writes accepted comment changes: the draft this pane checked, once per
 * call id, with the rows the user kept. Stop counts only until the write begins.
 */
export function createWordApplyCommentsExecutor({
  session = wordDocumentReadSession,
  readEnabled,
  bridge = wordWriteBridge,
}: {
  session?: WordDocumentReadSession;
  readEnabled: () => boolean;
  bridge?: () => WordWriteBridge | null;
}): ClientToolExecutor {
  return onceByCallId(async ({ submissionCallId, confirmation }, context) => {
    const replay = wordReplayedApply(context.toolCallId);
    if ("done" in replay) return replay.done;
    const host = bridge();
    if (!host)
      return wordApplyAnswer({ status: "unavailable", reason: "no_pane" });
    const draft = wordCommentDraft(submissionCallId);
    const identity = host.documentIdentity();
    if (replay.writing || !draft)
      return wordLostCaptureAnswer({
        context,
        session,
        bridge: host,
        readEnabled,
        expectedIdentity:
          draft?.identity ?? host.messageContext(context.messageId).identity,
        started: replay.writing || replay.unreadable,
      });
    if (!identity || draft.identity !== identity)
      return wordApplyAnswer({
        status: "unavailable",
        reason: "other_document",
      });
    if (wordCommentCardMode(draft) !== "post")
      return wordApplyAnswer({ status: "failed", reason: "copy_only" });
    const chosen = (confirmation as WordCommentConfirmation).selected;
    const selected = Array.isArray(chosen)
      ? draft.rows.map((row) => row.i).filter((i) => chosen.includes(i))
      : draft.rows.map((row) => row.i);
    // Without a label or with comments the read could not trust, the rows are kept on screen.
    const tainted = wordCommentTaintedMessage(context.messageId);
    if (wordCommentAlwaysBlock(draft, tainted) && !Array.isArray(chosen))
      return wordApplyAnswer({
        status: "needs_decision",
        reason: "comment_rows",
      });
    const tracking = await readWordTrackingMode();
    const plan = wordCommentAuthorPlan(draft, {
      host: draft.host,
      tracking,
      principalName: wordPrincipalName(),
      template: wordCommentDeploymentSettings().assistantAuthor,
    });
    if (context.signal?.aborted)
      return wordApplyAnswer({ status: "failed", reason: "stopped" });
    const until = Date.now() + WORD_APPLY_BUSY_WAIT_MS;
    while (!host.beginOperation()) {
      if (Date.now() >= until)
        return wordApplyAnswer({ status: "failed", reason: "busy" });
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const entry = WORD_CLIENT_ACTIONS.get(draft.action)!;
    const key = `${context.messageId}:${draft.action}:${submissionCallId}`;
    let result: WordApplyCallResult;
    try {
      if (context.signal?.aborted)
        return wordApplyAnswer({ status: "failed", reason: "stopped" });
      markWordApplyWriting(context.toolCallId, identity);
      host.updateReview(key, { status: "applying" });
      const capture: WordDocumentCapture = {
        identity,
        ordinalMap: new Map(),
        paragraphsSent: 0,
        renderedOrdinals: new Set(),
        partialOrdinal: null,
      };
      const run = await entry.execute({
        fenceContent: submissionCallId,
        capture,
        comments: {
          selected: new Set(selected),
          assistantAuthor: plan.authorName,
          userModeRows: new Set(plan.userModeRows.keys()),
        },
      });
      const rows = run.commentResult?.rows ?? [];
      if (run.commentResult?.timedOut)
        await Promise.race([
          run.commentResult.settled,
          new Promise((resolve) => setTimeout(resolve, SETTLE_CEILING_MS)),
        ]);
      const kept = rows.filter((row) => selected.includes(row.i));
      const done = kept.filter(applied).length;
      const state = {
        selected,
        rows,
        consent: "approved" as const,
        consentKind: "click" as const,
      };
      host.updateReview(key, {
        status: run.commentResult ? "done" : "write-failed",
        comments: state,
      });
      recordWordCommentOutcome(
        wordCommentOutcomeRecord({
          draft,
          ...state,
          authorModeRequested:
            draft.action === "word.add_comments" ? draft.authorMode : null,
        }),
      );
      wordCommentProposalApplied(submissionCallId);
      result = !run.commentResult
        ? { status: "unconfirmed", reason: "host_error" }
        : done === kept.length && done > 0
          ? { status: "applied", verified: true, undo_steps: 1 }
          : done > 0
            ? {
                status: "partial",
                verified: true,
                undo_steps: 1,
                left_out: kept
                  .filter((row) => !applied(row))
                  .map((row) => `#${row.i + 1}`),
              }
            : { status: "failed", reason: "not_applied" };
    } catch {
      host.updateReview(key, { status: "write-failed" });
      result = { status: "unconfirmed", reason: "host_error" };
    } finally {
      host.endOperation();
    }
    markWordApplyDone(context.toolCallId, identity, result);
    return wordApplyAnswer(result);
  });
}
