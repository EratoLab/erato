import {
  unlockWordContentControlsForImport,
  restoreWordContentControlLocks,
} from "./wordContentControlWrite";
import {
  captureWordDocumentPackage,
  currentWordDocumentUrl,
  decodeWordDocumentBackup,
  encodeWordDocumentBackup,
  insertWordDocumentFile,
  isWordDocumentBackup,
  supportsWordDocumentPackage,
  wordDocumentOoxmlToFile,
} from "./wordDocumentPackage";
import {
  parseWordDocumentPlan,
  validateWordDocumentPlan,
} from "./wordDocumentPlan";
import {
  captureWordAuthoringSnapshot,
  compileWordDocumentPlan,
  verifyWordPlanOutput,
  wordDocumentFingerprint,
  sameWordBodyContent,
} from "./wordDocumentXml";
import { finishWordEmptyDocumentImport } from "./wordEmptyDocumentImport";
import { wordWriteHost } from "./wordWriteHost";

import type { WordContentControlLocks } from "./wordContentControlWrite";
import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
  WordPlanIssue,
} from "./wordDocumentPlan";

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
    | "host-error";
  officeCode?: string;
  officeLocation?: string;
}
export interface WordDocumentApplyResult {
  status: WordDocumentApplyStatus;
  before?: string;
  /** Observed post-state, including an unverified/partially written result. */
  afterFingerprint?: string;
  diagnostic?: WordDocumentDiagnostic;
}
export interface WordDocumentRevertResult {
  status: "reverted" | "stale" | "interrupted";
  afterFingerprint?: string;
  diagnostic?: WordDocumentDiagnostic;
}

/** Only error codes/API locations, never statements, document text or raw debugInfo. */
function diagnostic(
  stage: WordDocumentDiagnostic["stage"],
  reason: WordDocumentDiagnostic["reason"],
  error?: unknown,
): WordDocumentDiagnostic {
  const record =
    typeof error === "object" && error !== null
      ? (error as Record<string, unknown>)
      : {};
  const info =
    typeof record.debugInfo === "object" && record.debugInfo !== null
      ? (record.debugInfo as Record<string, unknown>)
      : {};
  const code = record.code;
  const location = info.errorLocation;
  return {
    stage,
    reason,
    ...(typeof code === "string" && /^[A-Za-z][A-Za-z0-9.]{0,79}$/.test(code)
      ? { officeCode: code }
      : {}),
    ...(typeof location === "string" &&
    /^[A-Za-z][A-Za-z0-9_.()[\]-]{0,159}$/.test(location)
      ? { officeLocation: location }
      : {}),
  };
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
): Promise<WordDocumentApplyResult> {
  const plan = parseWordDocumentPlan(content);
  const host = wordWriteHost();
  const invalid = !host
    ? "host-unavailable"
    : !plan
      ? "invalid"
      : !snapshot
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
    // A serializer failure must stop before the native write boundary.
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
    if (snapshot.fullDocument)
      return await applyFullDocument(plan, snapshot, compiled, onBeforeWrite);
    stage = "preflight";
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
        return { status: "stale", diagnostic: diagnostic("preflight", reason) };
      before = live.value;
      onBeforeWrite?.(before);
      snapshot.used = true;
      stage = "write";
      writing = true;
      context.document.body.insertOoxml(compiled, "Replace");
      await context.sync();
      stage = "verify";
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
      if (!verifyWordPlanOutput(plan, snapshot, verified))
        return {
          status: "interrupted",
          before,
          afterFingerprint,
          diagnostic: diagnostic("verify", "output-mismatch"),
        };
      return { status: "applied", before, afterFingerprint };
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

/** The original snapshot remains available even if restoration is interrupted. */
export async function revertWordDocumentPlan(
  before: string,
  expectedAfter: string,
): Promise<WordDocumentRevertResult> {
  if (isWordDocumentBackup(before))
    return revertFullDocument(before, expectedAfter);
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
      if (!sameWordBodyContent(original, restored))
        return {
          status: "interrupted",
          afterFingerprint,
          diagnostic: diagnostic("restore", "output-mismatch"),
        };
      return { status: "reverted", afterFingerprint };
    });
  } catch (error) {
    return {
      status: writing ? "interrupted" : "stale",
      ...(writing ? { afterFingerprint: await observeAfterFailure() } : {}),
      diagnostic: diagnostic(stage, "host-error", error),
    };
  }
}

/** The model still supplies a typed plan. Only the host compiles a DOCX and
 * imports it at document scope, with an independent original saved first. */
async function applyFullDocument(
  plan: WordDocumentPlan,
  snapshot: WordAuthoringSnapshot,
  compiled: string,
  onBeforeWrite?: (before: string) => void,
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
  try {
    const bytes = wordDocumentOoxmlToFile(compiled);
    stage = "preflight";
    return await host.run(async (context) => {
      const live = await captureWordDocumentPackage();
      documentUrl = live.documentUrl;
      context.document.load("changeTrackingMode");
      await context.sync();
      const reason =
        snapshot.used || snapshot.revoked
          ? "expired"
          : context.document.changeTrackingMode !== "Off"
            ? "tracking"
            : live.fingerprint !== snapshot.fingerprint ||
                (snapshot.documentUrl !== undefined &&
                  live.documentUrl !== snapshot.documentUrl) ||
                currentWordDocumentUrl() !== live.documentUrl
              ? "source-changed"
              : null;
      if (reason)
        return { status: "stale", diagnostic: diagnostic("preflight", reason) };
      before = encodeWordDocumentBackup(live);
      onBeforeWrite?.(before);
      snapshot.used = true;
      stage = "write";
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
      const after = await captureWordDocumentPackage();
      if (
        after.documentUrl !== live.documentUrl ||
        currentWordDocumentUrl() !== live.documentUrl
      )
        return {
          status: "interrupted",
          before,
          diagnostic: diagnostic("verify", "output-mismatch"),
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
      if (!verifyWordPlanOutput(plan, snapshot, actual))
        return {
          status: "interrupted",
          before,
          afterFingerprint: after.fingerprint,
          diagnostic: diagnostic("verify", "output-mismatch"),
        };
      return { status: "applied", before, afterFingerprint: after.fingerprint };
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
      const reason =
        context.document.changeTrackingMode !== "Off"
          ? "tracking"
          : live.fingerprint !== expectedAfter ||
              live.documentUrl !== original.documentUrl ||
              currentWordDocumentUrl() !== live.documentUrl
            ? "source-changed"
            : null;
      if (reason)
        return { status: "stale", diagnostic: diagnostic("preflight", reason) };
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
          diagnostic: diagnostic("restore", "output-mismatch"),
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
      if (!sameWordBodyContent(expected, restored))
        return {
          status: "interrupted",
          afterFingerprint: after.fingerprint,
          diagnostic: diagnostic("restore", "output-mismatch"),
        };
      return { status: "reverted", afterFingerprint: after.fingerprint };
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
