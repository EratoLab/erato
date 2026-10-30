import {
  isWordHistorySnapshot,
  normalizeWordDocumentPlan,
  parseWordDocumentPlan,
  validateWordDocumentPlan,
  wordHousekeepingDifferences,
} from "@erato/frontend/word-review";

import {
  logWordDiagnostic,
  packageStats,
  strictDifferingParts,
  verifyDifferingParts,
  wordDocumentDiagnostic as diagnostic,
} from "./wordApplyDiagnostics";
import { wordApplyPolicy } from "./wordApplyPolicy";
import { trackWordApply, yieldToPaint } from "./wordApplyProgress";
import { beginWordOwnWrite, markWordOwnImport } from "./wordChangeJournal";
import {
  unlockWordContentControlsForImport,
  restoreWordContentControlLocks,
} from "./wordContentControlWrite";
import {
  captureWordDocumentPackage,
  currentWordDocumentUrl,
  decodeWordDocumentBackup,
  decodeWordInPlaceBackup,
  encodeWordDocumentBackup,
  insertWordDocumentFile,
  isWordDocumentBackup,
  supportsWordDocumentPackage,
  syncWordDocumentImport,
  wordDocumentOoxmlToFile,
  wordWrittenPackageFingerprint,
} from "./wordDocumentPackage";
import {
  captureWordAuthoringSnapshot,
  compileWordDocumentPlan,
  verifyWordPlanOutput,
  verifyWordPlanWrite,
  verifyWordRestore,
  wordBodyFingerprint,
  wordBodyRead,
} from "./wordDocumentXml";
import { finishWordEmptyDocumentImport } from "./wordEmptyDocumentImport";
import {
  wordInPlaceCapabilities,
  wordTrackedInPlaceCapabilities,
} from "./wordInPlaceCapabilities";
import {
  applyWordPlanInPlace,
  revertWordPlanInPlace,
  wordInPlaceFallbackScope,
} from "./wordInPlaceExecutor";
import {
  WORD_IN_PLACE_FALLBACKS,
  wordInPlaceFallbacks,
} from "./wordInPlacePlan";
import {
  routeWordDocumentPlan,
  wordPlanReadScope,
  wordWholeDocumentWrite,
} from "./wordInPlaceRoute";
import { isWordScopeFingerprint } from "./wordInPlaceState";
import {
  isWordTrackingMode,
  wordInPlaceAvailability,
  wordInPlaceCapabilitiesUnder,
  wordTrackedWritingAvailable,
} from "./wordInPlaceSwitch";
import {
  checkWordPlanComments,
  readWordCommentStates,
} from "./wordPlanCommentCheck";
import { wordPlanCommentConsequences } from "./wordPlanComments";
import { wordWriteHost } from "./wordWriteHost";

import type {
  WordDiagnosticDetails,
  WordRouteReason,
} from "./wordApplyDiagnostics";
import type { WordApplyProgress, WordApplyStage } from "./wordApplyProgress";
import type { WordContentControlLocks } from "./wordContentControlWrite";
import type { WordWriteVerification } from "./wordDocumentXml";
import type {
  WordApplyAdjustment,
  WordVerifyTier,
} from "./wordFullDocumentComparison";
import type { WordWholeDocumentRefusal } from "./wordInPlaceRoute";
import type {
  WordCommentThreadState,
  WordPlanCommentCheck,
} from "./wordPlanCommentCheck";
import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
  WordHousekeepingCounts,
  WordPlanCommentThread,
  WordPlanIssue,
} from "@erato/frontend/word-review";

export type WordDocumentApplyStatus =
  | "applied"
  | "stale"
  | "blocked"
  | "interrupted";
export interface WordDocumentDiagnostic {
  stage: "validate" | "compile" | "preflight" | "write" | "verify" | "restore";
  reason:
    | WordPlanIssue
    | "host-unavailable"
    | "wrong-request"
    | "source-changed"
    | "compile-failed"
    | "output-mismatch"
    | "package-growth"
    | "host-error"
    /** The host's policy asks before a whole-document write, and the user has not confirmed it. */
    | "import-needs-confirmation"
    /** The plan deletes comment threads and the user has not ticked that for this compiled plan. */
    | "comment-removals-need-confirmation"
    | WordWholeDocumentRefusal
    /** Word refused the write (NotAllowed) and the document is verifiably unchanged. */
    | "not-allowed";
  officeCode?: string;
  officeLocation?: string;
  details?: WordDiagnosticDetails;
}
/** How a verified write went in: which writer ran and how leniently its result was compared.
 * In place, "block" means untouched blocks kept their content and written ones match the plan. */
export interface WordApplyOutcome {
  route: "import" | "body" | "in-place";
  tier: WordVerifyTier | "block";
  adjustments: WordApplyAdjustment[];
  /** Object-model changes, for in-place writes. */
  ops?: number;
  /** Blocks someone changed elsewhere after the capture; an in-place write leaves them as they are. */
  outsideChanges?: number;
  /** Written as tracked revisions (true), or written directly although the capture was tracked
   * because Track Changes was off by then (false). */
  tracked?: boolean;
  /** Differences the checks left to WORD_HOUSEKEEPING, by rule. */
  housekeeping?: WordHousekeepingCounts;
  /** The comment threads after the write, against the plan; absent in a document without any. */
  comments?: WordPlanCommentCheck;
}
export interface WordDocumentApplyResult {
  status: WordDocumentApplyStatus;
  before?: string;
  /** Observed post-state, including an unverified/partially written result. */
  afterFingerprint?: string;
  diagnostic?: WordDocumentDiagnostic;
  outcome?: WordApplyOutcome;
}
export interface WordDocumentRevertResult {
  status: "reverted" | "stale" | "interrupted";
  afterFingerprint?: string;
  diagnostic?: WordDocumentDiagnostic;
  outcome?: WordApplyOutcome;
}

function outcome(
  route: "import" | "body",
  verification: Extract<WordWriteVerification, { ok: true }>,
  checked: WordHousekeepingCounts = {},
): WordApplyOutcome {
  const housekeeping: WordHousekeepingCounts = {
    ...verification.housekeeping,
  };
  for (const [id, n] of Object.entries(checked) as [
    keyof WordHousekeepingCounts,
    number,
  ][])
    housekeeping[id] = (housekeeping[id] ?? 0) + n;
  return {
    route,
    tier: verification.tier,
    adjustments: verification.adjustments,
    ...(Object.keys(housekeeping).length ? { housekeeping } : {}),
  };
}

function housekeepingDetails(
  counts: WordHousekeepingCounts,
): Pick<WordDiagnosticDetails, "housekeeping"> {
  return Object.keys(counts).length ? { housekeeping: counts } : {};
}

/** A content mismatch means the lenient tier failed too; growth is decided before any comparison. */
function failedTier(
  verification: Extract<WordWriteVerification, { ok: false }>,
): Pick<WordDiagnosticDetails, "verifyTier"> {
  return verification.reason === "output-mismatch"
    ? { verifyTier: "content" }
    : {};
}

/**
 * Word for the web refuses a whole-document write over content it cannot edit, such as a date
 * picker, which no API reports beforehand. Only a document observed unchanged afterwards makes that
 * a refusal rather than an interrupted write.
 */
function refusedUnchanged(
  error: unknown,
  stage: WordDocumentDiagnostic["stage"],
  observed: string | undefined,
  before: string | undefined,
): boolean {
  return (
    (stage === "write" || stage === "restore") &&
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "NotAllowed" &&
    observed !== undefined &&
    observed === before
  );
}

/** Read a fresh context after a rejected batch; never retry the mutation. `replaced` is the
 * complete package the write started from, so the fingerprint matches what Revert compares. */
async function observeAfterFailure(
  fullDocument = false,
  expectedUrl?: string,
  replaced?: string,
): Promise<string | undefined> {
  try {
    if (fullDocument) {
      if (expectedUrl !== undefined && currentWordDocumentUrl() !== expectedUrl)
        return undefined;
      const after = await captureWordDocumentPackage();
      if (expectedUrl !== undefined && after.documentUrl !== expectedUrl)
        return undefined;
      return replaced === undefined
        ? after.fingerprint
        : wordWrittenPackageFingerprint(after.ooxml, replaced).fingerprint;
    }
    return await wordWriteHost()?.run(async (context) => {
      const body = context.document.body.getOoxml();
      await context.sync();
      return wordBodyFingerprint(body.value);
    });
  } catch {
    return undefined;
  }
}

export interface WordDocumentApplyOptions {
  /** The user confirmed replacing the whole document, where the host's policy asks first. */
  importConfirmed?: boolean;
  /** The compiled plan's fingerprint for which the user ticked "Also delete N comment threads". */
  commentRemovalsConfirmed?: string;
}

export async function applyWordDocumentPlan(
  content: string,
  snapshot: WordAuthoringSnapshot | undefined,
  messageId?: string,
  onBeforeWrite?: (before: string) => void,
  onStage?: (stage: WordApplyStage) => void,
  options: WordDocumentApplyOptions = {},
): Promise<WordDocumentApplyResult> {
  const progress = trackWordApply("plan", onStage);
  const routing: { reason?: WordRouteReason } = {};
  const watch: CommentWatch = {};
  let result: WordDocumentApplyResult | undefined;
  const own = beginWordOwnWrite("ids");
  try {
    result = await applyPlan(
      content,
      snapshot,
      messageId,
      onBeforeWrite,
      progress,
      routing,
      options,
      watch,
    );
    result = await withCommentCheck(result, watch);
    return result;
  } finally {
    own.end();
    const details = result?.diagnostic?.details;
    progress.finish(result?.status ?? "error", {
      route: result?.outcome?.route ?? details?.route,
      routeReason: routing.reason,
      ops: result?.outcome?.ops ?? details?.inPlaceOps,
      tier: result?.outcome?.tier ?? details?.verifyTier,
    });
    if (result?.diagnostic)
      logWordDiagnostic("apply", result.status, result.diagnostic);
  }
}

/** The threads before the write and those the plan deletes, for documents that have comments. */
interface CommentWatch {
  before?: WordCommentThreadState[] | null;
  planned?: readonly WordPlanCommentThread[];
}

/** Every written apply, on every route, is followed by a comment check; nothing else is. */
async function withCommentCheck(
  result: WordDocumentApplyResult,
  watch: CommentWatch,
): Promise<WordDocumentApplyResult> {
  const written =
    result.status === "interrupted" ||
    (result.status === "applied" && result.outcome?.ops !== 0);
  if (!written || watch.before === undefined) return result;
  const comments = await checkWordPlanComments(
    watch.before,
    watch.planned ?? [],
    readWordCommentStates,
  );
  if (result.outcome)
    return { ...result, outcome: { ...result.outcome, comments } };
  return result.diagnostic
    ? {
        ...result,
        diagnostic: {
          ...result.diagnostic,
          details: { ...result.diagnostic.details, comments },
        },
      }
    : result;
}

/** The route reason rides on the diagnostic so the copyable report says why the import ran. */
function imported(
  result: WordDocumentApplyResult,
  routeReason: WordRouteReason | undefined,
  extra: WordDiagnosticDetails,
): WordDocumentApplyResult {
  if (!result.diagnostic) return result;
  return {
    ...result,
    diagnostic: {
      ...result.diagnostic,
      details: {
        route: "import",
        ...(routeReason ? { routeReason } : {}),
        ...extra,
        ...result.diagnostic.details,
      },
    },
  };
}

/** A whole-document write refused before anything was written or the capture was used. */
function wholeDocumentBlocked(
  reason: "tracking" | WordWholeDocumentGuard,
  route: "import" | "body",
  routeReason: WordRouteReason | undefined,
  fallbackReasons: () => WordRouteReason[],
  extra: WordDiagnosticDetails = {},
): WordDocumentApplyResult {
  const reasons = fallbackReasons();
  return {
    status: "blocked",
    diagnostic: diagnostic("validate", reason, undefined, {
      route,
      ...(routeReason ? { routeReason } : {}),
      fallbackReasons: reasons.length
        ? reasons
        : routeReason
          ? [routeReason]
          : [],
      ...extra,
    }),
  };
}

/** Track Changes rules the import out: it would replace the document without revisions. */
function trackingBlocked(
  routeReason: WordRouteReason | undefined,
  fallbackReasons: () => WordRouteReason[],
): WordDocumentApplyResult {
  return wholeDocumentBlocked(
    "tracking",
    "import",
    routeReason,
    fallbackReasons,
  );
}

type WordWholeDocumentGuard =
  | "import-needs-confirmation"
  | WordWholeDocumentRefusal;

/**
 * The host's policy decides here, not only on the card, so no caller or automatic run reaches a
 * whole-document write the user has not confirmed, and a scoped plan never reaches one at all.
 */
function wholeDocumentGuard(
  route: "import" | "body",
  routeReason: WordRouteReason | undefined,
  plan: WordDocumentPlan,
  snapshot: WordAuthoringSnapshot,
  options: WordDocumentApplyOptions,
  fallbackReasons: () => WordRouteReason[],
  compiled?: string,
): WordDocumentApplyResult | undefined {
  const write = wordWholeDocumentWrite(
    { route },
    plan,
    snapshot,
    wordApplyPolicy(),
    compiled,
  );
  const reason =
    write.write === "refuse"
      ? write.reason
      : write.write === "confirm" && !options.importConfirmed
        ? "import-needs-confirmation"
        : undefined;
  if (!reason) return undefined;
  const readScope = wordPlanReadScope(plan, snapshot);
  return wholeDocumentBlocked(
    reason,
    route,
    routeReason,
    fallbackReasons,
    readScope ? { readScope } : {},
  );
}

function trackedFallbacks(
  plan: WordDocumentPlan,
  snapshot: WordAuthoringSnapshot,
  prepared: WordAuthoringSnapshot,
): WordRouteReason[] {
  try {
    return wordInPlaceFallbacks(
      plan,
      snapshot,
      wordTrackedInPlaceCapabilities(wordInPlaceCapabilities()),
      prepared,
    );
  } catch {
    return [];
  }
}

async function applyPlan(
  content: string,
  snapshot: WordAuthoringSnapshot | undefined,
  messageId: string | undefined,
  onBeforeWrite: ((before: string) => void) | undefined,
  progress: WordApplyProgress,
  routing: { reason?: WordRouteReason },
  options: WordDocumentApplyOptions,
  watch: CommentWatch,
): Promise<WordDocumentApplyResult> {
  progress.stage("checking");
  // Parsing, compiling and verifying below are synchronous; let the busy button paint first.
  await yieldToPaint();
  const parsed = parseWordDocumentPlan(content);
  const plan = parsed && normalizeWordDocumentPlan(parsed, snapshot);
  const host = wordWriteHost();
  const invalid = !host
    ? "host-unavailable"
    : !plan
      ? "invalid"
      : !snapshot || isWordHistorySnapshot(snapshot)
        ? "no-capture"
        : !messageId || snapshot.ownerMessageId !== messageId
          ? "wrong-request"
          : validateWordDocumentPlan(plan, snapshot);
  if (invalid || !host || !plan || !snapshot)
    return {
      status: "blocked",
      diagnostic: diagnostic("validate", invalid || "invalid"),
    };
  let writing = false;
  let before: string | undefined;
  let stage: WordDocumentDiagnostic["stage"] = "compile";
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
        status: "blocked",
        diagnostic: diagnostic("compile", "compile-failed"),
      };
    // Asked of every route and caller, Always and auto-prompt included: only the tick consents.
    const comments = wordPlanCommentConsequences(snapshot, compiled, prepared);
    if (
      comments.removals.length &&
      options.commentRemovalsConfirmed !== comments.fingerprint
    )
      return {
        status: "blocked",
        diagnostic: diagnostic(
          "validate",
          "comment-removals-need-confirmation",
          undefined,
          { commentThreads: comments.removals.length },
        ),
      };
    watch.planned = comments.removals.map((removal) => removal.thread);
    // Read once consent and the guards passed; a route's own stale check can still refuse after it.
    const watchComments = async () => {
      if (comments.threads.length && watch.before === undefined)
        watch.before = await readWordCommentStates();
    };
    if (snapshot.fullDocument) {
      // All or nothing per plan: in place only when every change has an exact object-model inverse.
      let routeReason: WordRouteReason | undefined;
      let fallbackDetails: WordDiagnosticDetails = {};
      const route = routeWordDocumentPlan(
        plan,
        snapshot,
        wordInPlaceAvailability(),
        wordInPlaceCapabilities(),
        prepared,
      );
      if (route.route === "import" || route.route === "blocked")
        routeReason = route.reason;
      else if (route.route === "in-place" && !route.ops.length) {
        snapshot.used = true;
        return {
          status: "applied",
          outcome: {
            route: "in-place",
            tier: "block",
            adjustments: [],
            ops: 0,
          },
        };
      } else if (route.route === "in-place") {
        await watchComments();
        const result = await applyWordPlanInPlace({
          snapshot,
          compiled: prepared,
          ops: route.ops,
          onBeforeWrite,
          progress,
          observePackage: (url, replaced) =>
            observeAfterFailure(true, url, replaced),
        });
        if (!("fallback" in result)) return result;
        // Track Changes is on and the write needs something tracked writing does not cover.
        if (result.fallback === "tracking") {
          const live = result.details.fallbackReasons ?? [];
          return trackingBlocked(undefined, () => [
            ...new Set([
              ...trackedFallbacks(plan, snapshot, prepared),
              ...live,
            ]),
          ]);
        }
        routeReason = result.fallback;
        fallbackDetails = result.details;
      }
      routing.reason = routeReason;
      const fallbackReasons = (): WordRouteReason[] => {
        if (
          !routeReason ||
          !(WORD_IN_PLACE_FALLBACKS as readonly string[]).includes(routeReason)
        )
          return routeReason ? [routeReason] : [];
        try {
          return wordInPlaceFallbacks(
            plan,
            snapshot,
            wordInPlaceCapabilitiesUnder(snapshot.trackingMode),
            prepared,
          );
        } catch {
          return [routeReason];
        }
      };
      if (isWordTrackingMode(snapshot.trackingMode))
        return trackingBlocked(routeReason, fallbackReasons);
      const guarded = wholeDocumentGuard(
        "import",
        routeReason,
        plan,
        snapshot,
        options,
        fallbackReasons,
        compiled,
      );
      if (guarded) return guarded;
      await watchComments();
      return imported(
        await applyFullDocument(
          plan,
          snapshot,
          compiled,
          onBeforeWrite,
          progress,
          () => trackingBlocked(routeReason, fallbackReasons),
        ),
        routeReason,
        fallbackDetails,
      );
    }
    const guarded = wholeDocumentGuard(
      "body",
      undefined,
      plan,
      snapshot,
      options,
      () => [],
    );
    if (guarded) return guarded;
    await watchComments();
    stage = "preflight";
    progress.stage("backup");
    return await host.run(async (context) => {
      context.document.load("changeTrackingMode");
      const live = context.document.body.getOoxml();
      await context.sync();
      const read = wordBodyRead(live.value);
      const checked = wordHousekeepingDifferences(
        snapshot.housekeeping,
        read.housekeeping,
      );
      const reason =
        snapshot.revoked || snapshot.used
          ? "expired"
          : context.document.changeTrackingMode !== "Off"
            ? "tracking"
            : read.fingerprint !== snapshot.fingerprint
              ? "source-changed"
              : null;
      if (reason)
        return {
          status: "stale",
          diagnostic: diagnostic(
            "preflight",
            reason,
            undefined,
            reason === "source-changed"
              ? {
                  ...strictDifferingParts(snapshot.ooxml, live.value),
                  ...housekeepingDetails(checked),
                }
              : {},
          ),
        };
      before = live.value;
      onBeforeWrite?.(before);
      snapshot.used = true;
      stage = "write";
      progress.stage("writing");
      writing = true;
      markWordOwnImport();
      context.document.body.insertOoxml(compiled, "Replace");
      await context.sync();
      stage = "verify";
      progress.stage("verifying");
      const after = context.document.body.getOoxml();
      context.document.load("changeTrackingMode");
      await context.sync();
      const verified = captureWordAuthoringSnapshot(
        after.value,
        snapshot.identity,
        String(context.document.changeTrackingMode),
        false,
        "verify",
      );
      const afterFingerprint = verified.fingerprint || undefined;
      const verification = verifyWordPlanWrite(plan, snapshot, verified);
      if (!verification.ok)
        return {
          status: "interrupted",
          before,
          afterFingerprint,
          diagnostic: diagnostic("verify", verification.reason, undefined, {
            ...strictDifferingParts(compiled, after.value),
            ...(verified.issue ? { snapshotIssue: verified.issue } : {}),
            ...failedTier(verification),
            ...packageStats([
              ["expected", compiled],
              ["actual", after.value],
            ]),
          }),
        };
      return {
        status: "applied",
        before,
        afterFingerprint,
        outcome: outcome("body", verification, checked),
      };
    });
  } catch (error) {
    const afterFingerprint = writing ? await observeAfterFailure() : undefined;
    if (refusedUnchanged(error, stage, afterFingerprint, snapshot?.fingerprint))
      return {
        status: "blocked",
        diagnostic: diagnostic("write", "not-allowed", error),
      };
    return {
      status: writing ? "interrupted" : "blocked",
      ...(writing ? { before, afterFingerprint } : {}),
      diagnostic: diagnostic(
        stage,
        stage === "compile" ? "compile-failed" : "host-error",
        error,
      ),
    };
  }
}

export async function revertWordDocumentPlan(
  before: string,
  expectedAfter: string,
): Promise<WordDocumentRevertResult> {
  const own = beginWordOwnWrite("ids");
  const result = await revertPlan(before, expectedAfter).finally(() =>
    own.end(),
  );
  if (result.diagnostic)
    logWordDiagnostic("revert", result.status, result.diagnostic);
  return result;
}

/** How Revert would undo a recorded write, as revertPlan dispatches it. */
export type WordRevertMechanism = "in-place" | "tracked" | "import" | "body";

export function wordRevertMechanism(
  before: string,
  expectedAfter: string | undefined,
): WordRevertMechanism {
  if (!isWordDocumentBackup(before)) return "body";
  if (!expectedAfter || !isWordScopeFingerprint(expectedAfter)) return "import";
  try {
    return decodeWordInPlaceBackup(before).inPlace?.tracked
      ? "tracked"
      : "in-place";
  } catch {
    return "in-place";
  }
}

function writtenInPlace(before: string): boolean {
  try {
    return !!decodeWordInPlaceBackup(before).inPlace;
  } catch {
    return false;
  }
}

/**
 * Revert of an in-place write that did not verify restores the complete original, a whole-document
 * import nobody confirmed. Unless the host's policy allows the import outright, only a write whose
 * differences all lie in its own paragraphs is undone, in place; the rest is left to Word's Undo
 * and the downloadable original. A confirmed import's own Revert is not affected.
 */
export function wordRevertImportRefusal(
  before: string,
  expectedAfter: string | undefined,
): Extract<
  WordDocumentDiagnostic["reason"],
  "import-needs-confirmation" | "import-disabled"
> | null {
  if (
    !expectedAfter ||
    !isWordDocumentBackup(before) ||
    isWordScopeFingerprint(expectedAfter) ||
    !writtenInPlace(before) ||
    wordInPlaceFallbackScope(before)
  )
    return null;
  const policy = wordApplyPolicy().wholeDocumentImport;
  return policy === "allowed"
    ? null
    : policy === "off"
      ? "import-disabled"
      : "import-needs-confirmation";
}

async function revertPlan(
  before: string,
  expectedAfter: string,
): Promise<WordDocumentRevertResult> {
  if (isWordDocumentBackup(before)) {
    if (isWordScopeFingerprint(expectedAfter))
      return revertWordPlanInPlace(before, expectedAfter);
    const refusal = wordRevertImportRefusal(before, expectedAfter);
    if (refusal)
      return {
        status: "stale",
        diagnostic: diagnostic("preflight", refusal, undefined, {
          route: "in-place",
        }),
      };
    const confined =
      writtenInPlace(before) &&
      wordApplyPolicy().wholeDocumentImport !== "allowed"
        ? wordInPlaceFallbackScope(before)
        : undefined;
    if (confined) return revertWordPlanInPlace(before, confined);
    const exact = await revertFullDocument(before, expectedAfter);
    const scope =
      exact.status === "stale" &&
      exact.diagnostic?.reason === "source-changed" &&
      !exact.diagnostic.details?.urlChanged
        ? wordInPlaceFallbackScope(before)
        : undefined;
    return scope ? revertWordPlanInPlace(before, scope) : exact;
  }
  const host = wordWriteHost();
  if (!host)
    return {
      status: "stale",
      diagnostic: diagnostic("preflight", "host-unavailable"),
    };
  let writing = false;
  let stage: WordDocumentDiagnostic["stage"] = "preflight";
  try {
    return await host.run(async (context) => {
      context.document.load("changeTrackingMode");
      const live = context.document.body.getOoxml();
      await context.sync();
      const reason =
        context.document.changeTrackingMode !== "Off"
          ? "tracking"
          : wordBodyFingerprint(live.value) !== expectedAfter
            ? "source-changed"
            : null;
      if (reason)
        return { status: "stale", diagnostic: diagnostic("preflight", reason) };
      writing = true;
      stage = "restore";
      markWordOwnImport();
      context.document.body.insertOoxml(before, "Replace");
      await context.sync();
      stage = "verify";
      const after = context.document.body.getOoxml();
      context.document.load("changeTrackingMode");
      await context.sync();
      const restored = captureWordAuthoringSnapshot(
        after.value,
        "recovery",
        String(context.document.changeTrackingMode),
        false,
        "verify",
      );
      const original = captureWordAuthoringSnapshot(
        before,
        "recovery",
        "Off",
        false,
        "verify",
      );
      const afterFingerprint = restored.fingerprint || undefined;
      const verification = verifyWordRestore(original, restored);
      if (!verification.ok)
        return {
          status: "interrupted",
          afterFingerprint,
          diagnostic: diagnostic("restore", verification.reason, undefined, {
            ...strictDifferingParts(before, after.value),
            ...failedTier(verification),
            ...packageStats([
              ["expected", before],
              ["actual", after.value],
            ]),
          }),
        };
      return {
        status: "reverted",
        afterFingerprint,
        outcome: outcome("body", verification),
      };
    });
  } catch (error) {
    const afterFingerprint = writing ? await observeAfterFailure() : undefined;
    if (refusedUnchanged(error, stage, afterFingerprint, expectedAfter))
      return notAllowedRevert(error);
    return {
      status: writing ? "interrupted" : "stale",
      ...(writing ? { afterFingerprint } : {}),
      diagnostic: diagnostic(stage, "host-error", error),
    };
  }
}

/** Nothing was restored and running Revert again would meet the same refusal, so it is reported
 * like a Revert the document's state ruled out. */
function notAllowedRevert(error: unknown): WordDocumentRevertResult {
  return {
    status: "stale",
    diagnostic: diagnostic("restore", "not-allowed", error),
  };
}

async function applyFullDocument(
  plan: WordDocumentPlan,
  snapshot: WordAuthoringSnapshot,
  compiled: string,
  onBeforeWrite: ((before: string) => void) | undefined,
  progress: WordApplyProgress,
  blockedByTracking?: () => WordDocumentApplyResult,
): Promise<WordDocumentApplyResult> {
  const host = wordWriteHost();
  if (!host || !supportsWordDocumentPackage())
    return {
      status: "blocked",
      diagnostic: diagnostic("preflight", "host-unavailable"),
    };
  let stage: WordDocumentDiagnostic["stage"] = "compile";
  let writing = false;
  let before: string | undefined;
  let documentUrl: string | undefined;
  let locks: WordContentControlLocks = [];
  let imported = false;
  let liveOoxml: string | undefined;
  try {
    const bytes = wordDocumentOoxmlToFile(compiled);
    stage = "preflight";
    progress.stage("backup");
    return await host.run(async (context) => {
      const live = await captureWordDocumentPackage();
      documentUrl = live.documentUrl;
      liveOoxml = live.ooxml;
      context.document.load("changeTrackingMode");
      await context.sync();
      const contentChanged = live.fingerprint !== snapshot.fingerprint;
      const urlChanged =
        (snapshot.documentUrl !== undefined &&
          live.documentUrl !== snapshot.documentUrl) ||
        currentWordDocumentUrl() !== live.documentUrl;
      // Turned on since the capture: where tracked writing exists this plan simply needs it.
      if (
        blockedByTracking &&
        !snapshot.used &&
        !snapshot.revoked &&
        context.document.changeTrackingMode !== "Off" &&
        wordTrackedWritingAvailable()
      )
        return blockedByTracking();
      const reason =
        snapshot.used || snapshot.revoked
          ? "expired"
          : context.document.changeTrackingMode !== "Off"
            ? "tracking"
            : contentChanged || urlChanged
              ? "source-changed"
              : null;
      if (reason)
        return {
          status: "stale",
          diagnostic: diagnostic(
            "preflight",
            reason,
            undefined,
            reason === "source-changed"
              ? {
                  ...(contentChanged
                    ? strictDifferingParts(snapshot.ooxml, live.ooxml)
                    : {}),
                  ...(urlChanged ? { urlChanged } : {}),
                  ...packageStats([
                    ["source", snapshot.ooxml],
                    ["live", live.ooxml],
                  ]),
                }
              : {},
          ),
        };
      before = encodeWordDocumentBackup(live);
      onBeforeWrite?.(before);
      snapshot.used = true;
      stage = "write";
      progress.stage("writing");
      markWordOwnImport();
      await unlockWordContentControlsForImport(context, {
        onLocksCaptured: (value) => {
          locks = value;
        },
        onMutationStart: () => {
          if (currentWordDocumentUrl() !== live.documentUrl)
            throw new Error("The active document changed before unlocking");
          writing = true;
        },
      });
      if (currentWordDocumentUrl() !== live.documentUrl)
        throw new Error("The active document changed before import");
      writing = true;
      insertWordDocumentFile(context, bytes);
      await syncWordDocumentImport(context);
      imported = true;
      await finishWordEmptyDocumentImport(context, compiled);
      stage = "verify";
      progress.stage("verifying");
      const after = await captureWordDocumentPackage();
      if (
        after.documentUrl !== live.documentUrl ||
        currentWordDocumentUrl() !== live.documentUrl
      )
        return {
          status: "interrupted",
          before,
          diagnostic: diagnostic("verify", "output-mismatch", undefined, {
            urlChanged: true,
          }),
        };
      context.document.load("changeTrackingMode");
      await context.sync();
      const actual = captureWordAuthoringSnapshot(
        after.ooxml,
        snapshot.identity,
        String(context.document.changeTrackingMode),
        true,
        "verify",
      );
      // Revert compares against this, written the same way from the package it would restore.
      const afterFingerprint = wordWrittenPackageFingerprint(
        after.ooxml,
        live.ooxml,
        actual.fingerprint,
      ).fingerprint;
      const verification = verifyWordPlanWrite(plan, snapshot, actual);
      if (!verification.ok)
        return {
          status: "interrupted",
          before,
          afterFingerprint,
          diagnostic: diagnostic("verify", verification.reason, undefined, {
            ...verifyDifferingParts(compiled, after.ooxml),
            ...(actual.issue ? { snapshotIssue: actual.issue } : {}),
            ...failedTier(verification),
            ...packageStats([
              ["live", live.ooxml],
              ["expected", compiled],
              ["actual", after.ooxml],
            ]),
          }),
        };
      return {
        status: "applied",
        before,
        afterFingerprint,
        outcome: outcome("import", verification),
      };
    });
  } catch (error) {
    if (!imported && locks.length)
      await restoreWordContentControlLocks(host, locks, {
        canRestore: () => currentWordDocumentUrl() === documentUrl,
      });
    const afterFingerprint = writing
      ? await observeAfterFailure(true, documentUrl, liveOoxml)
      : undefined;
    if (refusedUnchanged(error, stage, afterFingerprint, snapshot.fingerprint))
      return {
        status: "blocked",
        diagnostic: diagnostic("write", "not-allowed", error),
      };
    return {
      status: writing ? "interrupted" : "blocked",
      ...(writing ? { before, afterFingerprint } : {}),
      diagnostic: diagnostic(
        stage,
        stage === "compile" ? "compile-failed" : "host-error",
        error,
        packageStats([
          ["live", liveOoxml],
          ["expected", compiled],
        ]),
      ),
    };
  }
}

async function revertFullDocument(
  before: string,
  expectedAfter: string,
): Promise<WordDocumentRevertResult> {
  const host = wordWriteHost();
  if (!host || !supportsWordDocumentPackage())
    return {
      status: "stale",
      diagnostic: diagnostic("preflight", "host-unavailable"),
    };
  let stage: WordDocumentDiagnostic["stage"] = "preflight";
  let writing = false;
  let documentUrl: string | undefined;
  let originalOoxml: string | undefined;
  let locks: WordContentControlLocks = [];
  let imported = false;
  try {
    const original = decodeWordDocumentBackup(before);
    documentUrl = original.documentUrl;
    originalOoxml = original.ooxml;
    return await host.run(async (context) => {
      const live = await captureWordDocumentPackage();
      context.document.load("changeTrackingMode");
      await context.sync();
      const written = wordWrittenPackageFingerprint(live.ooxml, original.ooxml);
      const contentChanged = written.fingerprint !== expectedAfter;
      const checked: WordHousekeepingCounts = written.redetected
        ? { "proofing-language": written.redetected }
        : {};
      const urlChanged =
        live.documentUrl !== original.documentUrl ||
        currentWordDocumentUrl() !== live.documentUrl;
      const reason =
        context.document.changeTrackingMode !== "Off"
          ? "tracking"
          : contentChanged || urlChanged
            ? "source-changed"
            : null;
      if (reason)
        return {
          status: "stale",
          diagnostic: diagnostic(
            "preflight",
            reason,
            undefined,
            reason === "source-changed"
              ? {
                  ...(urlChanged ? { urlChanged } : {}),
                  ...housekeepingDetails(checked),
                  ...packageStats([
                    ["source", original.ooxml],
                    ["live", live.ooxml],
                  ]),
                }
              : {},
          ),
        };
      stage = "restore";
      markWordOwnImport();
      await unlockWordContentControlsForImport(context, {
        onLocksCaptured: (value) => {
          locks = value;
        },
        onMutationStart: () => {
          if (currentWordDocumentUrl() !== original.documentUrl)
            throw new Error("The active document changed before unlocking");
          writing = true;
        },
      });
      if (currentWordDocumentUrl() !== original.documentUrl)
        throw new Error("The active document changed before restore");
      writing = true;
      insertWordDocumentFile(context, original.bytes);
      await syncWordDocumentImport(context);
      imported = true;
      await finishWordEmptyDocumentImport(context, original.ooxml);
      stage = "verify";
      const after = await captureWordDocumentPackage();
      if (
        after.documentUrl !== original.documentUrl ||
        currentWordDocumentUrl() !== original.documentUrl
      )
        return {
          status: "interrupted",
          diagnostic: diagnostic("restore", "output-mismatch", undefined, {
            urlChanged: true,
          }),
        };
      context.document.load("changeTrackingMode");
      await context.sync();
      const restored = captureWordAuthoringSnapshot(
        after.ooxml,
        "recovery",
        String(context.document.changeTrackingMode),
        true,
        "verify",
      );
      const expected = captureWordAuthoringSnapshot(
        original.ooxml,
        "recovery",
        "Off",
        true,
        "verify",
      );
      const afterFingerprint = wordWrittenPackageFingerprint(
        after.ooxml,
        original.ooxml,
        restored.fingerprint,
      ).fingerprint;
      const verification = verifyWordRestore(expected, restored, live.ooxml);
      if (!verification.ok)
        return {
          status: "interrupted",
          afterFingerprint,
          diagnostic: diagnostic("restore", verification.reason, undefined, {
            ...verifyDifferingParts(original.ooxml, after.ooxml),
            ...failedTier(verification),
            ...packageStats([
              ["live", live.ooxml],
              ["expected", original.ooxml],
              ["actual", after.ooxml],
            ]),
          }),
        };
      return {
        status: "reverted",
        afterFingerprint,
        outcome: outcome("import", verification, checked),
      };
    });
  } catch (error) {
    if (!imported && locks.length)
      await restoreWordContentControlLocks(host, locks, {
        canRestore: () => currentWordDocumentUrl() === documentUrl,
      });
    const afterFingerprint = writing
      ? await observeAfterFailure(true, documentUrl, originalOoxml)
      : undefined;
    if (refusedUnchanged(error, stage, afterFingerprint, expectedAfter))
      return notAllowedRevert(error);
    return {
      status: writing ? "interrupted" : "stale",
      ...(writing ? { afterFingerprint } : {}),
      diagnostic: diagnostic(stage, "host-error", error),
    };
  }
}
