import {
  normalizeWordDocumentPlan,
  parseWordDocumentPlan,
} from "@erato/frontend/word-review";

import { wordAcceptedPlan } from "./wordAcceptedSubmissions";
import {
  markWordApplyDone,
  markWordApplyWriting,
  wordApplyCallMarker,
} from "./wordApplyCallMarkers";
import {
  wordListedNames,
  wordPlanChangedSections,
} from "./wordApprovalPreview";
import { wordCompleteReadBudgetFor } from "./wordAuthoringBudget";
import { WORD_CLIENT_ACTIONS } from "./wordClientActions";
import { wordDocumentReadSession } from "./wordDocumentReadTool";
import { captureWordImageAssets } from "./wordImageAssets";
import {
  runWordPlanApply,
  wordPlanChecksCoauthors,
  wordPlanRouting,
} from "./wordPlanApply";
import { wordWholeDocumentBlockWrite } from "./wordReviewState";
import { wordWriteBridge } from "./wordWriteBridge";

import type { WordDocumentApplyResult } from "./wordApplyDocumentPlan";
import type { WordDocumentReadSession } from "./wordDocumentReadTool";
import type { WordCoauthorNotice } from "./wordPlanApply";
import type { WordVerifiedBody } from "./wordRequestCapture";
import type { WordWriteBridge } from "./wordWriteBridge";
import type {
  ClientToolCallContext,
  ClientToolExecutionResult,
  ClientToolExecutor,
} from "@erato/frontend/library";

export const WORD_APPLY_PLAN_TOOL = "apply_document_plan";
export const WORD_APPLY_COMMENTS_TOOL = "apply_comment_changes";

export type WordApplyStatus =
  | "applied"
  | "partial"
  | "unconfirmed"
  | "needs_decision"
  | "failed"
  | "stale"
  | "unavailable";

/** What an apply tells the server and the model: content-free except section names. */
export interface WordApplyCallResult {
  status: WordApplyStatus;
  verified?: boolean;
  changed?: string[];
  left_out?: string[];
  undo_steps?: number;
  snapshot?: string;
  needs_follow_up?: boolean;
  reason?: string;
}

/** The choices the user made on the decision-place card, sent back with the approval. */
export interface WordPlanConfirmation {
  importConfirmed?: boolean;
  commentRemovalsConfirmed?: string;
  coauthors?: WordCoauthorNotice;
}

export interface WordApplyInput {
  submissionCallId: string;
  confirmation: Record<string, unknown>;
}

/** Waiting longer than this for another card's write answers busy. */
export const WORD_APPLY_BUSY_WAIT_MS = 10_000;

export function parseWordApplyInput(input: unknown): WordApplyInput | null {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    return null;
  const { proposal_call_id: callId, confirmation } = input as Record<
    string,
    unknown
  >;
  if (typeof callId !== "string" || !callId) return null;
  return {
    submissionCallId: callId,
    confirmation:
      typeof confirmation === "object" &&
      confirmation !== null &&
      !Array.isArray(confirmation)
        ? (confirmation as Record<string, unknown>)
        : {},
  };
}

export const wordApplyAnswer = (
  result: WordApplyCallResult,
): ClientToolExecutionResult => ({ ok: true, result });

/** Calls in flight or done, by call id: a redelivered call never writes twice. */
export function onceByCallId(
  execute: (
    input: WordApplyInput,
    context: ClientToolCallContext,
  ) => Promise<ClientToolExecutionResult>,
): ClientToolExecutor {
  const calls = new Map<string, Promise<ClientToolExecutionResult>>();
  return (input, context) => {
    if (!context)
      return Promise.resolve(
        wordApplyAnswer({ status: "unavailable", reason: "no_request" }),
      );
    const parsed = parseWordApplyInput(input);
    if (!parsed)
      return Promise.resolve(
        wordApplyAnswer({ status: "failed", reason: "invalid_input" }),
      );
    const running = calls.get(context.toolCallId);
    if (running) return running;
    const call = execute(parsed, context).then((answer) => {
      // The server sends the same call again once the user decided on screen.
      if (
        answer.ok &&
        (answer.result as WordApplyCallResult | undefined)?.status ===
          "needs_decision"
      )
        calls.delete(context.toolCallId);
      return answer;
    });
    calls.set(context.toolCallId, call);
    return call;
  };
}

/**
 * An apply whose copy of the document is gone: the pane reloaded, or a newer request took it.
 * Nothing is written. With the same document open and the request known, the next read of this
 * answer takes a new copy; a write that had started answers unconfirmed, so Erato reads first.
 */
export function wordLostCaptureAnswer({
  context,
  session,
  bridge,
  readEnabled,
  expectedIdentity,
  started,
}: {
  context: ClientToolCallContext;
  session: WordDocumentReadSession;
  bridge: WordWriteBridge;
  readEnabled: () => boolean;
  expectedIdentity: string | undefined;
  started: boolean;
}): ClientToolExecutionResult {
  const identity = bridge.documentIdentity();
  const sameDocument =
    identity && identity === expectedIdentity ? identity : undefined;
  // Another document counts only when both are known: a write that may have begun never reads
  // as "not changed", and an unknown document gets no new copy.
  if (!started && identity && expectedIdentity && !sameDocument)
    return wordApplyAnswer({ status: "unavailable", reason: "other_document" });
  const stored = bridge.messageContext(context.messageId);
  const ownSession =
    session.snapshotForSubmission(context) !== undefined
      ? session.request
      : undefined;
  const requestText = ownSession ?? stored.requestText;
  const { chatId } = context;
  const { modelId, fileIds } = stored;
  const snapshot =
    sameDocument && readEnabled() && requestText && chatId
      ? session.reserveSuccessor({
          chatId,
          messageId: context.messageId,
          identity: sameDocument,
          requestText,
          ...(fileIds
            ? { captureImages: () => captureWordImageAssets(fileIds) }
            : {}),
          // The chat's assistant comes with the chat; the model must be the answer's own.
          ...(modelId
            ? {
                budgetFor: wordCompleteReadBudgetFor({
                  message: requestText,
                  chatId,
                  modelId,
                  fileIds,
                }),
              }
            : {}),
        })
      : undefined;
  return wordApplyAnswer({
    status: started ? "unconfirmed" : "stale",
    reason: started ? "reloaded_during_write" : "capture_lost",
    ...(snapshot ? { snapshot } : {}),
  });
}

/** A replay of a call this pane already started: its stored result, or whether it was writing. */
export function wordReplayedApply(
  callId: string,
):
  | { done: ClientToolExecutionResult }
  | { writing: boolean; unreadable: boolean; identity?: string } {
  const marker = wordApplyCallMarker(callId);
  if (marker?.state === "done")
    return { done: wordApplyAnswer(marker.result as WordApplyCallResult) };
  return {
    writing: marker?.state === "writing",
    unreadable: marker === null,
    identity: marker?.identity,
  };
}

function mapPlanResult(
  result: WordDocumentApplyResult | undefined,
  base: { changed: string[]; leftOut: readonly string[] },
): WordApplyCallResult {
  const leftOut = wordListedNames(base.leftOut);
  switch (result?.status) {
    case "applied":
      return {
        status: leftOut.length ? "partial" : "applied",
        verified: true,
        changed: base.changed,
        left_out: leftOut,
        undo_steps: result.before ? 1 : 0,
      };
    case "interrupted":
      return {
        status: "partial",
        verified: false,
        changed: base.changed,
        left_out: leftOut,
        undo_steps: 1,
        needs_follow_up: true,
        reason: "not_verified",
      };
    case "stale":
      return { status: "stale", reason: "document_changed" };
    case "blocked":
      return {
        status: "failed",
        reason: `blocked:${result.diagnostic?.reason ?? "unknown"}`,
      };
    default:
      return { status: "failed", reason: "host_error" };
  }
}

/**
 * The server's call that writes an accepted document plan. It writes only the plan this pane
 * checked, on the copy it was checked against, once per call id; Stop counts only until the
 * write begins.
 */
export function createWordApplyPlanExecutor({
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
    const accepted = wordAcceptedPlan(submissionCallId);
    const snapshot = session.snapshotForSubmission(context);
    const capture = session.liveCapture(accepted?.snapshotToken);
    const expectedIdentity =
      snapshot?.identity ??
      host.messageContext(context.messageId).identity ??
      replay.identity;
    if (
      replay.writing ||
      !accepted ||
      accepted.messageId !== context.messageId ||
      !snapshot ||
      !capture ||
      capture.authoring !== snapshot ||
      snapshot.used ||
      snapshot.revoked
    )
      return wordLostCaptureAnswer({
        context,
        session,
        bridge: host,
        readEnabled,
        expectedIdentity,
        // Unreadable storage cannot rule out a write this call started before a reload.
        started: replay.writing || replay.unreadable,
      });
    const identity = host.documentIdentity();
    if (!identity || identity !== snapshot.identity)
      return wordApplyAnswer({
        status: "unavailable",
        reason: "other_document",
      });
    const parsed = parseWordDocumentPlan(accepted.content);
    const plan = parsed && normalizeWordDocumentPlan(parsed, snapshot);
    if (!plan) return wordApplyAnswer({ status: "failed", reason: "invalid" });
    const routing = wordPlanRouting(plan, snapshot, accepted.content);
    const confirmed = confirmation as WordPlanConfirmation;
    if (routing?.write.write === "refuse")
      return wordApplyAnswer({
        status: "failed",
        reason: `blocked:${routing.write.reason}`,
      });
    const needsDecision = (reason: string) =>
      wordApplyAnswer({ status: "needs_decision", reason });
    if (
      routing?.write.write === "confirm" &&
      confirmed.importConfirmed !== true
    )
      return needsDecision("whole_document");
    if (
      routing?.comments?.removals.length &&
      confirmed.commentRemovalsConfirmed !== routing.comments.fingerprint
    )
      return needsDecision("comment_removals");
    const changed = wordPlanChangedSections(plan, snapshot);
    const entry = WORD_CLIENT_ACTIONS.get("word.apply_document_plan")!;
    const key = `${context.messageId}:${entry.action}:${accepted.content}`;
    let writing = false;
    const outcome = await runWordPlanApply({
      key,
      content: accepted.content,
      capture,
      messageId: context.messageId,
      entry,
      host,
      importConfirmed: confirmed.importConfirmed === true,
      commentRemovalsConfirmed: confirmed.commentRemovalsConfirmed,
      coauthors: wordPlanChecksCoauthors(routing)
        ? { shown: confirmed.coauthors }
        : undefined,
      showDiagnosticOnCommentTick: false,
      waitForOperationMs: WORD_APPLY_BUSY_WAIT_MS,
      signal: context.signal,
      onBeforeWrite: () => {
        writing = true;
        markWordApplyWriting(context.toolCallId, identity);
      },
    });
    let result: WordApplyCallResult;
    let verified: WordVerifiedBody | undefined;
    switch (outcome.kind) {
      case "busy":
        result = { status: "failed", reason: "busy" };
        break;
      case "stopped":
        result = { status: "failed", reason: "stopped" };
        break;
      case "coauthors":
        return needsDecision("coauthors");
      case "comment-tick":
        return needsDecision("comment_removals");
      case "whole-document":
        // A refusal is the host's rule, not a question for the user.
        if (wordWholeDocumentBlockWrite(outcome.diagnostic).write === "confirm")
          return needsDecision("whole_document");
        result = {
          status: "failed",
          reason: `blocked:${outcome.diagnostic.reason}`,
        };
        break;
      case "host-error":
        result = writing
          ? { status: "unconfirmed", reason: "host_error" }
          : { status: "failed", reason: "host_error" };
        break;
      case "ran":
        result = mapPlanResult(outcome.run.documentPlanResult, {
          changed,
          leftOut: accepted.leftOut,
        });
        verified = outcome.run.documentPlanResult?.verifiedBody;
        break;
    }
    if (readEnabled() && context.chatId)
      result.snapshot = session.reserveSuccessor({
        chatId: context.chatId,
        messageId: context.messageId,
        identity,
        verified,
      });
    markWordApplyDone(context.toolCallId, identity, result);
    return wordApplyAnswer(result);
  });
}
