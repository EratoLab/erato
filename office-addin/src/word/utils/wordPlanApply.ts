import { wordApplyHost, wordApplyPolicy } from "./wordApplyPolicy";
import { wordRoutePreviewText } from "./wordAuthoringMessages";
import { readWordCoauthoring } from "./wordCoauthoring";
import {
  captureWordAuthoringSnapshot,
  compileWordDocumentPlan,
} from "./wordDocumentXml";
import { wordHostPlatform } from "./wordHostPlatform";
import { wordInPlaceCapabilities } from "./wordInPlaceCapabilities";
import {
  routeWordDocumentPlan,
  wordPlanPassages,
  wordWholeDocumentWrite,
} from "./wordInPlaceRoute";
import { wordInPlaceAvailability } from "./wordInPlaceSwitch";
import { wordPlanCommentConsequences } from "./wordPlanComments";
import { isWordWholeDocumentBlock } from "./wordReviewState";

import type { WordDocumentDiagnostic } from "./wordApplyDocumentPlan";
import type {
  WordClientActionEntry,
  WordClientActionRun,
} from "./wordClientActions";
import type { WordCoauthoringState } from "./wordCoauthoring";
import type { WordPlanRoute, WordWholeDocumentWrite } from "./wordInPlaceRoute";
import type {
  WordReviewState,
  WordWholeDocumentBlock,
} from "./wordReviewState";
import type { WordRevertSlot } from "../providers/WordWriteProvider";
import type {
  WordAuthoringSnapshot,
  WordDocumentCapture,
  WordDocumentPlan,
} from "@erato/frontend/word-review";

/** How the plan would be written, what it would do to comments, and whether Word must ask first. */
export interface WordPlanRouting {
  route: WordPlanRoute["route"];
  text: string | undefined;
  write: WordWholeDocumentWrite;
  comments: ReturnType<typeof wordPlanCommentConsequences>;
}

export type WordCoauthorNotice = "editing" | "pending";

export function wordCoauthorNotice(
  state: WordCoauthoringState | undefined,
): WordCoauthorNotice | undefined {
  return state?.othersEditing
    ? "editing"
    : state?.pendingUpdates
      ? "pending"
      : undefined;
}

// Compiling a plan is the costly part of a review: the card, the decision-place card and the
// apply executor share one routing per copy of the document and plan.
const routings = new WeakMap<
  WordAuthoringSnapshot,
  Map<string, WordPlanRouting | null>
>();

/** What routing depends on besides the plan and the copy: a change here routes the plan again. */
export function wordPlanRoutingEnvironment(): string {
  const availability = wordInPlaceAvailability();
  return JSON.stringify([
    availability.enabled ? "" : availability.reason,
    wordApplyPolicy(),
    wordInPlaceCapabilities(),
  ]);
}

export function wordPlanRouting(
  plan: WordDocumentPlan,
  snapshot: WordAuthoringSnapshot,
  content: string,
): WordPlanRouting | undefined {
  const availability = wordInPlaceAvailability();
  const unavailable = availability.enabled ? undefined : availability.reason;
  const policy = wordApplyPolicy();
  const capabilities = wordInPlaceCapabilities();
  const cacheKey = JSON.stringify([
    unavailable ?? "",
    policy,
    capabilities,
    content,
  ]);
  let cache = routings.get(snapshot);
  const cached = cache?.get(cacheKey);
  if (cached !== undefined) return cached ?? undefined;
  let routing: WordPlanRouting | null = null;
  try {
    const xml = compileWordDocumentPlan(plan, snapshot);
    const compiled = captureWordAuthoringSnapshot(
      xml,
      snapshot.identity,
      "Off",
      snapshot.fullDocument,
      "verify",
    );
    if (!compiled.issue) {
      const route = routeWordDocumentPlan(
        plan,
        snapshot,
        unavailable
          ? { enabled: false, reason: unavailable }
          : { enabled: true },
        capabilities,
        compiled,
      );
      routing = {
        route: route.route,
        text: wordRoutePreviewText(route, wordPlanPassages(plan)),
        write: wordWholeDocumentWrite(route, plan, snapshot, policy, xml),
        comments: wordPlanCommentConsequences(snapshot, xml, compiled),
      };
    }
  } catch {
    routing = null;
  }
  if (!cache) {
    cache = new Map();
    routings.set(snapshot, cache);
  }
  cache.set(cacheKey, routing);
  return routing ?? undefined;
}

/** Whether replacing the whole document waits for co-authors to be read first (Word for Windows). */
export function wordPlanChecksCoauthors(
  routing: Pick<WordPlanRouting, "route"> | undefined,
): boolean {
  return (
    wordApplyHost(wordHostPlatform()) === "pc" &&
    (routing?.route === "import" || routing?.route === "body")
  );
}

/** What a card or an executor needs from the pane's write host. */
export interface WordPlanApplyHost {
  beginOperation: () => boolean;
  endOperation: () => void;
  updateReview: (key: string, patch: Partial<WordReviewState>) => void;
  setRevertSlot: (slot: WordRevertSlot | null) => void;
  invalidateLocations: () => void;
}

export type WordPlanApplyOutcome =
  | { kind: "busy" }
  /** Stopped before the write began; nothing was written. */
  | { kind: "stopped" }
  /** Co-authors joined or left since the review was shown; nothing was written. */
  | { kind: "coauthors"; now: WordCoauthorNotice | undefined }
  /** The plan deletes comment threads the user has not ticked for this compiled plan. */
  | { kind: "comment-tick"; diagnostic?: WordDocumentDiagnostic }
  /** The host's policy asks before replacing the whole document. */
  | { kind: "whole-document"; diagnostic: WordWholeDocumentBlock }
  | { kind: "ran"; run: WordClientActionRun }
  | { kind: "host-error" };

const OPERATION_POLL_MS = 100;

/** Takes Word's one operation, waiting up to `waitMs` for another to end. */
export async function beginWithin(
  host: Pick<WordPlanApplyHost, "beginOperation">,
  waitMs: number,
): Promise<boolean> {
  const until = Date.now() + waitMs;
  for (;;) {
    if (host.beginOperation()) return true;
    if (Date.now() >= until) return false;
    await new Promise((resolve) => setTimeout(resolve, OPERATION_POLL_MS));
  }
}

/**
 * Writes one checked plan for the server's apply call: the co-author check, one host operation at
 * a time, the write, the revert slot and the review the cards show.
 */
export async function runWordPlanApply({
  key,
  content,
  capture,
  messageId,
  entry,
  host,
  importConfirmed,
  commentRemovalsConfirmed,
  coauthors,
  waitForOperationMs = 0,
  signal,
  onBeforeWrite,
}: {
  key: string;
  content: string;
  capture: WordDocumentCapture;
  messageId: string | undefined;
  entry: WordClientActionEntry;
  host: WordPlanApplyHost;
  importConfirmed: boolean;
  commentRemovalsConfirmed?: string;
  /** Set when the write replaces the whole document on Word for Windows: what the user saw. */
  coauthors?: { shown: WordCoauthorNotice | undefined };
  waitForOperationMs?: number;
  /** Honoured only until the write begins: a write is never left half done. */
  signal?: AbortSignal;
  onBeforeWrite?: () => void;
}): Promise<WordPlanApplyOutcome> {
  if (signal?.aborted) return { kind: "stopped" };
  if (coauthors) {
    const now = wordCoauthorNotice(await readWordCoauthoring());
    if (now !== coauthors.shown && now) return { kind: "coauthors", now };
  }
  if (
    !host.beginOperation() &&
    (waitForOperationMs <= 0 || !(await beginWithin(host, waitForOperationMs)))
  )
    return { kind: "busy" };
  if (signal?.aborted) {
    host.endOperation();
    return { kind: "stopped" };
  }
  host.updateReview(key, {
    status: "applying",
    applyStage: "checking",
    capture,
    documentPlanDiagnostic: undefined,
    documentPlanOutcome: undefined,
  });
  try {
    const run = await entry.execute({
      fenceContent: content,
      capture,
      messageId,
      onStage: (applyStage) => host.updateReview(key, { applyStage }),
      onBeforeDocumentWrite: (before) => {
        onBeforeWrite?.();
        if (messageId)
          host.setRevertSlot({
            messageId,
            batchKey: key,
            identity: capture.identity,
            ooxml: before,
          });
      },
      importConfirmed,
      commentRemovalsConfirmed,
    });
    const result = run.documentPlanResult;
    if (
      result?.status === "blocked" &&
      result.diagnostic?.reason === "comment-removals-need-confirmation"
    ) {
      host.updateReview(key, { applyStage: undefined, status: "idle" });
      return { kind: "comment-tick", diagnostic: result.diagnostic };
    }
    if (
      result?.status === "blocked" &&
      isWordWholeDocumentBlock(result.diagnostic)
    ) {
      host.updateReview(key, {
        applyStage: undefined,
        status: "idle",
        wholeDocumentBlock: result.diagnostic,
      });
      return { kind: "whole-document", diagnostic: result.diagnostic };
    }
    if (result?.before) {
      host.invalidateLocations();
      host.setRevertSlot(
        messageId
          ? {
              messageId,
              batchKey: key,
              identity: capture.identity,
              ooxml: result.before,
              afterFingerprint: result.afterFingerprint,
            }
          : null,
      );
    }
    host.updateReview(key, {
      applyStage: undefined,
      status: run.ok
        ? "done"
        : result?.status === "interrupted"
          ? "write-failed"
          : "error",
      documentPlanStatus: result?.status,
      documentPlanDiagnostic: result?.diagnostic,
      documentPlanOutcome: result?.outcome,
      wholeDocumentBlock: undefined,
      detailsExpanded: false,
    });
    return { kind: "ran", run };
  } catch {
    host.updateReview(key, {
      applyStage: undefined,
      status: "write-failed",
      documentPlanStatus: "interrupted",
      documentPlanDiagnostic: { stage: "write", reason: "host-error" },
      wholeDocumentBlock: undefined,
    });
    return { kind: "host-error" };
  } finally {
    host.endOperation();
  }
}
