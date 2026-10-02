import {
  isWordHistorySnapshot,
  normalizeWordDocumentPlan,
  parseWordDocumentPlan,
  validateWordDocumentPlan,
} from "@erato/frontend/word-review";

import {
  logWordDiagnostic,
  packageStats,
  strictDifferingParts,
  verifyDifferingParts,
  wordDocumentDiagnostic as diagnostic,
} from "./wordApplyDiagnostics";
import { trackWordApply, yieldToPaint } from "./wordApplyProgress";
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
  wordDocumentOoxmlToFile,
} from "./wordDocumentPackage";
import {
  captureWordAuthoringSnapshot,
  compileWordDocumentPlan,
  verifyWordPlanOutput,
  verifyWordPlanWrite,
  verifyWordRestore,
  wordDocumentFingerprint,
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
import { routeWordDocumentPlan } from "./wordInPlaceRoute";
import { isWordScopeFingerprint } from "./wordInPlaceState";
import {
  isWordTrackingMode,
  wordInPlaceAvailability,
  wordInPlaceCapabilitiesUnder,
  wordTrackedWritingAvailable,
} from "./wordInPlaceSwitch";
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
import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
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
    | "host-error";
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
): WordApplyOutcome {
  return {
    route,
    tier: verification.tier,
    adjustments: verification.adjustments,
  };
}

/** A content mismatch means the lenient tier failed too; growth is decided before any comparison. */
function failedTier(
  verification: Extract<WordWriteVerification, { ok: false }>,
): Pick<WordDiagnosticDetails, "verifyTier"> {
  return verification.reason === "output-mismatch"
    ? { verifyTier: "content" }
    : {};
}

/** Read a fresh context after a rejected batch; never retry the mutation. */
async function observeAfterFailure(
  fullDocument = false,
  expectedUrl?: string,
): Promise<string | undefined> {
  try {
    if (fullDocument) {
      if (expectedUrl !== undefined && currentWordDocumentUrl() !== expectedUrl)
        return undefined;
      const after = await captureWordDocumentPackage();
      return expectedUrl === undefined || after.documentUrl === expectedUrl
        ? after.fingerprint
        : undefined;
    }
    return await wordWriteHost()?.run(async (context) => {
      const body = context.document.body.getOoxml();
      await context.sync();
      return wordDocumentFingerprint(body.value);
    });
  } catch {
    return undefined;
  }
}

export async function applyWordDocumentPlan(
  content: string,
  snapshot: WordAuthoringSnapshot | undefined,
  messageId?: string,
  onBeforeWrite?: (before: string) => void,
  onStage?: (stage: WordApplyStage) => void,
): Promise<WordDocumentApplyResult> {
  const progress = trackWordApply("plan", onStage);
  const routing: { reason?: WordRouteReason } = {};
  let result: WordDocumentApplyResult | undefined;
  try {
    result = await applyPlan(
      content,
      snapshot,
      messageId,
      onBeforeWrite,
      progress,
      routing,
    );
    return result;
  } finally {
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

/** Track Changes rules the import out: it would replace the document without revisions. */
function trackingBlocked(
  routeReason: WordRouteReason | undefined,
  fallbackReasons: () => WordRouteReason[],
): WordDocumentApplyResult {
  const reasons = fallbackReasons();
  return {
    status: "blocked",
    diagnostic: diagnostic("validate", "tracking", undefined, {
      route: "import",
      ...(routeReason ? { routeReason } : {}),
      fallbackReasons: reasons.length
        ? reasons
        : routeReason
          ? [routeReason]
          : [],
    }),
  };
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
        const result = await applyWordPlanInPlace({
          snapshot,
          compiled: prepared,
          ops: route.ops,
          onBeforeWrite,
          progress,
          observePackage: (url) => observeAfterFailure(true, url),
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
    stage = "preflight";
    progress.stage("backup");
    return await host.run(async (context) => {
      context.document.load("changeTrackingMode");
      const live = context.document.body.getOoxml();
      await context.sync();
      const reason =
        snapshot.revoked || snapshot.used
          ? "expired"
          : context.document.changeTrackingMode !== "Off"
            ? "tracking"
            : wordDocumentFingerprint(live.value) !== snapshot.fingerprint
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
              ? strictDifferingParts(snapshot.ooxml, live.value)
              : {},
          ),
        };
      before = live.value;
      onBeforeWrite?.(before);
      snapshot.used = true;
      stage = "write";
      progress.stage("writing");
      writing = true;
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
        outcome: outcome("body", verification),
      };
    });
  } catch (error) {
    return {
      status: writing ? "interrupted" : "blocked",
      ...(writing
        ? { before, afterFingerprint: await observeAfterFailure() }
        : {}),
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
  const result = await revertPlan(before, expectedAfter);
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

async function revertPlan(
  before: string,
  expectedAfter: string,
): Promise<WordDocumentRevertResult> {
  if (isWordDocumentBackup(before)) {
    if (isWordScopeFingerprint(expectedAfter))
      return revertWordPlanInPlace(before, expectedAfter);
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
          : wordDocumentFingerprint(live.value) !== expectedAfter
            ? "source-changed"
            : null;
      if (reason)
        return { status: "stale", diagnostic: diagnostic("preflight", reason) };
      writing = true;
      stage = "restore";
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
    return {
      status: writing ? "interrupted" : "stale",
      ...(writing ? { afterFingerprint: await observeAfterFailure() } : {}),
      diagnostic: diagnostic(stage, "host-error", error),
    };
  }
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
      await context.sync();
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
      // The snapshot fingerprints the same package; the lazy package fingerprint is only a fallback.
      const afterFingerprint = actual.fingerprint || after.fingerprint;
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
    return {
      status: writing ? "interrupted" : "blocked",
      ...(writing
        ? {
            before,
            afterFingerprint: await observeAfterFailure(true, documentUrl),
          }
        : {}),
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
  let locks: WordContentControlLocks = [];
  let imported = false;
  try {
    const original = decodeWordDocumentBackup(before);
    documentUrl = original.documentUrl;
    return await host.run(async (context) => {
      const live = await captureWordDocumentPackage();
      context.document.load("changeTrackingMode");
      await context.sync();
      const contentChanged = live.fingerprint !== expectedAfter;
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
                  ...packageStats([
                    ["source", original.ooxml],
                    ["live", live.ooxml],
                  ]),
                }
              : {},
          ),
        };
      stage = "restore";
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
      await context.sync();
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
      const afterFingerprint = restored.fingerprint || after.fingerprint;
      const verification = verifyWordRestore(expected, restored);
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
        outcome: outcome("import", verification),
      };
    });
  } catch (error) {
    if (!imported && locks.length)
      await restoreWordContentControlLocks(host, locks, {
        canRestore: () => currentWordDocumentUrl() === documentUrl,
      });
    return {
      status: writing ? "interrupted" : "stale",
      ...(writing
        ? { afterFingerprint: await observeAfterFailure(true, documentUrl) }
        : {}),
      diagnostic: diagnostic(stage, "host-error", error),
    };
  }
}
