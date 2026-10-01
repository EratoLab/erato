import {
  packageStats,
  strictDifferingParts,
  wordDocumentDiagnostic as diagnostic,
} from "./wordApplyDiagnostics";
import {
  captureWordDocumentPackage,
  currentWordDocumentUrl,
  decodeWordInPlaceBackup,
  encodeWordDocumentBackup,
  supportsWordDocumentPackage,
  withWordInPlaceBackup,
} from "./wordDocumentPackage";
import { captureWordAuthoringSnapshot } from "./wordDocumentXml";
import {
  decodeWordScopeFingerprint,
  encodeWordScopeFingerprint,
  verifyWordInPlaceOutput,
  wordFirstRunMarks,
  wordParagraphSignature,
} from "./wordInPlaceState";
import { latchWordInPlace } from "./wordInPlaceSwitch";
import {
  predictWordBodyParagraphs,
  wordParagraphAlignmentIssue,
} from "./wordLiveParagraphs";
import { wordWriteHost } from "./wordWriteHost";

import type { WordDiagnosticDetails } from "./wordApplyDiagnostics";
import type {
  WordDocumentApplyResult,
  WordDocumentDiagnostic,
  WordDocumentRevertResult,
} from "./wordApplyDocumentPlan";
import type { WordApplyProgress } from "./wordApplyProgress";
import type {
  WordInPlaceBackup,
  WordInPlaceBackupOp,
} from "./wordDocumentPackage";
import type { WordAuthoringSnapshot } from "./wordDocumentPlan";
import type {
  WordInPlaceMarks,
  WordInPlaceOp,
  WordInPlaceRun,
} from "./wordInPlacePlan";
import type { WordLiveParagraph } from "./wordLiveParagraphs";

/** The prediction of body.paragraphs did not hold; nothing was written or saved yet. */
export interface WordInPlaceFallbackResult {
  fallback: "alignment";
  details: Pick<WordDiagnosticDetails, "paragraphs" | "locations">;
}

const PARAGRAPH_FIELDS =
  "items/uniqueLocalId,items/tableNestingLevel,items/text";

function liveParagraphs(
  collection: Word.ParagraphCollection,
): WordLiveParagraph[] {
  return collection.items.map((p) => ({
    id: p.uniqueLocalId,
    nesting: p.tableNestingLevel,
    text: p.text,
  }));
}

const sameLive = (a: WordLiveParagraph[], b: WordLiveParagraph[]) =>
  a.length === b.length &&
  a.every(
    (p, i) =>
      p.id === b[i].id && p.nesting === b[i].nesting && p.text === b[i].text,
  );

/** Each range inherits the marks of the run before it ("Replace" keeps the first run's), so a mark
 * is set only where the wanted value differs. */
export function queueWordInPlaceTextWrite(
  paragraph: Word.Paragraph,
  runs: readonly WordInPlaceRun[],
  inherited: WordInPlaceMarks,
): void {
  let previous = inherited;
  runs.forEach((run, index) => {
    const range = paragraph.insertText(
      run.text,
      index === 0 ? "Replace" : "End",
    );
    if (run.bold !== previous.bold) range.font.bold = run.bold;
    if (run.italic !== previous.italic) range.font.italic = run.italic;
    if (run.underline !== previous.underline)
      range.font.underline = run.underline ? "Single" : "None";
    previous = run;
  });
}

function queueWrite(
  paragraph: Word.Paragraph,
  op: WordInPlaceOp,
  inherited: WordInPlaceMarks,
  direction: "apply" | "revert",
): void {
  if (op.kind === "cell")
    paragraph.insertText(
      direction === "apply" ? op.text : op.original,
      "Replace",
    );
  else
    queueWordInPlaceTextWrite(
      paragraph,
      direction === "apply" ? op.runs : op.original,
      inherited,
    );
}

const blockLocation = (ref: string, field: string) =>
  /^b\d{1,5}$/.test(ref)
    ? `/word/document.xml body block ${ref.slice(1)}: ${field}`
    : `/word/document.xml body: ${field}`;

export interface WordInPlaceApplyInput {
  snapshot: WordAuthoringSnapshot;
  /** The dry-run compile of the plan, captured for verification. */
  compiled: WordAuthoringSnapshot;
  ops: readonly WordInPlaceOp[];
  onBeforeWrite?: (before: string) => void;
  progress: WordApplyProgress;
  /** Fresh read of the whole package after a rejected batch, when the touched paragraphs cannot be read. */
  observePackage: (documentUrl?: string) => Promise<string | undefined>;
}

/**
 * Writes typed paragraph and table-cell text through the object model in one batch, after a
 * sandwich read (paragraphs, exact .docx, paragraphs again) proves the live document is the
 * captured one and that every target is where the package says it is.
 */
export async function applyWordPlanInPlace(
  input: WordInPlaceApplyInput,
): Promise<WordDocumentApplyResult | WordInPlaceFallbackResult> {
  const { snapshot, compiled, ops, onBeforeWrite, progress } = input;
  const route = { route: "in-place" as const, inPlaceOps: ops.length };
  const host = wordWriteHost();
  if (!host || !supportsWordDocumentPackage())
    return {
      status: "blocked",
      diagnostic: diagnostic("preflight", "host-unavailable", undefined, route),
    };
  // Assigned inside the Word.run callback; the cast keeps TypeScript from narrowing it here.
  let stage = "preflight" as WordDocumentDiagnostic["stage"];
  let writing = false;
  let before: string | undefined;
  let documentUrl: string | undefined;
  let record: WordInPlaceBackupOp[] = [];
  try {
    const predicted = predictWordBodyParagraphs(snapshot.ooxml);
    const firstOf = new Map<string, number>();
    predicted.forEach((p, i) => {
      if (!firstOf.has(p.ref)) firstOf.set(p.ref, i);
    });
    const targets = ops
      .map((op) => ({
        op,
        position: (firstOf.get(op.ref) ?? -1) + op.paragraph,
      }))
      .sort((a, b) => b.position - a.position);
    const fallback = (
      live?: number,
      locations: string[] = [],
    ): WordInPlaceFallbackResult => ({
      fallback: "alignment",
      details: {
        ...(live === undefined
          ? {}
          : { paragraphs: { predicted: predicted.length, live } }),
        ...(locations.length ? { locations } : {}),
      },
    });
    if (
      targets.some(
        ({ op, position }) =>
          predicted[position]?.ref !== op.ref ||
          predicted[position].index !== op.paragraph,
      )
    )
      return fallback();
    const checked = new Set<number>();
    for (const block of snapshot.blocks)
      if (block.type !== "native" && firstOf.has(block.ref))
        checked.add(firstOf.get(block.ref)!);
    for (const { position } of targets)
      for (const i of [position - 1, position, position + 1])
        if (i >= 0 && i < predicted.length) checked.add(i);
    progress.stage("backup");
    return await host.run(async (context) => {
      context.document.load("changeTrackingMode");
      const first = context.document.body.paragraphs;
      first.load(PARAGRAPH_FIELDS);
      await context.sync();
      const tracking = String(context.document.changeTrackingMode);
      const liveA = liveParagraphs(first);
      const structural = wordParagraphAlignmentIssue(predicted, liveA, []);
      if (structural)
        return fallback(
          liveA.length,
          structural.index === undefined
            ? []
            : [
                `/word/document.xml paragraph ${structural.index + 1}: ${structural.issue}`,
              ],
        );
      const live = await captureWordDocumentPackage();
      documentUrl = live.documentUrl;
      const contentChanged = live.fingerprint !== snapshot.fingerprint;
      const urlChanged =
        (snapshot.documentUrl !== undefined &&
          live.documentUrl !== snapshot.documentUrl) ||
        currentWordDocumentUrl() !== live.documentUrl;
      const reason =
        snapshot.used || snapshot.revoked
          ? "expired"
          : tracking !== "Off"
            ? "tracking"
            : contentChanged || urlChanged
              ? "source-changed"
              : null;
      if (reason)
        return {
          status: "stale",
          diagnostic: diagnostic("preflight", reason, undefined, {
            ...route,
            ...(reason === "source-changed"
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
              : {}),
          }),
        };
      const second = context.document.body.paragraphs;
      second.load(PARAGRAPH_FIELDS);
      const proxies = targets.map(({ position }) => first.items[position]);
      const ooxml = proxies.map((p) => p.getOoxml());
      const cells = targets.map(({ op }, i) => {
        if (op.kind !== "cell") return undefined;
        const cell = proxies[i].parentTableCellOrNullObject;
        cell.load("rowIndex,cellIndex");
        return cell;
      });
      await context.sync();
      const liveB = liveParagraphs(second);
      const textIssue = sameLive(liveA, liveB)
        ? wordParagraphAlignmentIssue(predicted, liveB, checked)
        : { issue: "changed" as const, index: undefined };
      if (textIssue)
        return {
          status: "stale",
          diagnostic: diagnostic("preflight", "source-changed", undefined, {
            ...route,
            paragraphs: { predicted: predicted.length, live: liveB.length },
            ...(textIssue.index === undefined
              ? {}
              : {
                  locations: [
                    `/word/document.xml paragraph ${textIssue.index + 1}: ${textIssue.issue}`,
                  ],
                }),
          }),
        };
      const misplaced = targets.findIndex(({ op, position }, i) => {
        const cell = cells[i];
        return (
          op.kind === "cell" &&
          (!cell ||
            cell.isNullObject ||
            cell.rowIndex !== op.rowIndex ||
            cell.cellIndex !== op.cellIndex ||
            liveB[position].nesting !== 1)
        );
      });
      if (misplaced >= 0)
        return fallback(liveB.length, [
          blockLocation(targets[misplaced].op.ref, "cell"),
        ]);
      record = targets.map(({ op, position }, i) => ({
        ...op,
        id: liveB[position].id,
        originalSignature: wordParagraphSignature(ooxml[i].value),
      }));
      const inherited = ooxml.map((r) => wordFirstRunMarks(r.value));
      before = encodeWordDocumentBackup(live, { v: 1, ops: record });
      onBeforeWrite?.(before);
      snapshot.used = true;
      stage = "write";
      progress.stage("writing");
      writing = true;
      targets.forEach(({ op }, i) =>
        queueWrite(proxies[i], op, inherited[i], "apply"),
      );
      await context.sync();
      stage = "verify";
      progress.stage("verifying");
      const written = proxies.map((p) => p.getOoxml());
      await context.sync();
      record = record.map((op, i) => ({
        ...op,
        afterSignature: wordParagraphSignature(written[i].value),
      }));
      before = withWordInPlaceBackup(before, { v: 1, ops: record });
      const afterFingerprint = encodeWordScopeFingerprint(
        record.map((op) => [op.id, op.afterSignature!]),
      );
      const after = await captureWordDocumentPackage();
      if (
        after.documentUrl !== live.documentUrl ||
        currentWordDocumentUrl() !== live.documentUrl
      ) {
        latchWordInPlace("verify-mismatch");
        return {
          status: "interrupted",
          before,
          afterFingerprint,
          diagnostic: diagnostic("verify", "output-mismatch", undefined, {
            ...route,
            urlChanged: true,
          }),
        };
      }
      context.document.load("changeTrackingMode");
      await context.sync();
      const trackingAfter = String(context.document.changeTrackingMode);
      const actual = captureWordAuthoringSnapshot(
        after.ooxml,
        snapshot.identity,
        trackingAfter,
        true,
        "verify",
      );
      const verification =
        trackingAfter === tracking
          ? verifyWordInPlaceOutput(ops, snapshot, compiled, actual)
          : { ok: false as const, locations: ["/word/settings.xml: tracking"] };
      if (!verification.ok) {
        latchWordInPlace("verify-mismatch");
        return {
          status: "interrupted",
          before,
          afterFingerprint,
          diagnostic: diagnostic("verify", "output-mismatch", undefined, {
            ...route,
            verifyTier: "block",
            locations: verification.locations,
            ...(actual.issue ? { snapshotIssue: actual.issue } : {}),
            ...packageStats([
              ["live", live.ooxml],
              ["actual", after.ooxml],
            ]),
          }),
        };
      }
      return {
        status: "applied",
        before,
        afterFingerprint,
        outcome: {
          route: "in-place",
          tier: "block",
          adjustments: [],
          ops: ops.length,
        },
      };
    });
  } catch (error) {
    if (!writing)
      return {
        status: "blocked",
        diagnostic: diagnostic(stage, "host-error", error, route),
      };
    latchWordInPlace("interrupted");
    const observed = before
      ? await observeWordInPlace(record).catch(() => undefined)
      : undefined;
    if (observed && before)
      before = withWordInPlaceBackup(before, { v: 1, ops: observed.ops });
    return {
      status: "interrupted",
      before,
      afterFingerprint:
        observed?.afterFingerprint ?? (await input.observePackage(documentUrl)),
      diagnostic: diagnostic(stage, "host-error", error, {
        ...route,
        ...(observed && stage === "write" ? { partial: observed.partial } : {}),
      }),
    };
  }
}

/** Fresh read of the touched paragraphs after a rejected batch; never retries the write. */
async function observeWordInPlace(ops: readonly WordInPlaceBackupOp[]) {
  const host = wordWriteHost();
  if (!host || !ops.length) return undefined;
  return host.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load("items/uniqueLocalId");
    await context.sync();
    const byId = new Map(paragraphs.items.map((p) => [p.uniqueLocalId, p]));
    const reads = ops.map((op) => {
      const paragraph = byId.get(op.id);
      if (!paragraph)
        throw new Error("A written paragraph is no longer present.");
      return paragraph.getOoxml();
    });
    await context.sync();
    const observed = ops.map((op, i) => ({
      ...op,
      afterSignature: wordParagraphSignature(reads[i].value),
    }));
    const untouched = observed.filter(
      (op) => op.afterSignature === op.originalSignature,
    ).length;
    return {
      ops: observed,
      afterFingerprint: encodeWordScopeFingerprint(
        observed.map((op) => [op.id, op.afterSignature]),
      ),
      partial: { applied: observed.length - untouched, untouched },
    };
  });
}

/**
 * Undo an in-place write paragraph by paragraph. Each touched paragraph must still be exactly what
 * the write left (it is rewritten) or exactly the original (it is skipped); anything else means a
 * later edit, and nothing is written.
 */
export async function revertWordPlanInPlace(
  before: string,
  expectedAfter: string,
): Promise<WordDocumentRevertResult> {
  const route = { route: "in-place" as const };
  let backup: { documentUrl: string; inPlace?: WordInPlaceBackup };
  try {
    backup = decodeWordInPlaceBackup(before);
  } catch {
    return {
      status: "stale",
      diagnostic: diagnostic("preflight", "invalid", undefined, route),
    };
  }
  const expected = decodeWordScopeFingerprint(expectedAfter);
  const ops = backup.inPlace?.ops ?? [];
  const host = wordWriteHost();
  if (!host)
    return {
      status: "stale",
      diagnostic: diagnostic("preflight", "host-unavailable", undefined, route),
    };
  if (!expected || !ops.length)
    return {
      status: "stale",
      diagnostic: diagnostic("preflight", "invalid", undefined, route),
    };
  const details = { ...route, inPlaceOps: ops.length };
  let stage: WordDocumentDiagnostic["stage"] = "preflight";
  let writing = false;
  const observedScope = async () =>
    (await observeWordInPlace(ops).catch(() => undefined))?.afterFingerprint;
  try {
    return await host.run(async (context) => {
      if (currentWordDocumentUrl() !== backup.documentUrl)
        return {
          status: "stale",
          diagnostic: diagnostic("preflight", "source-changed", undefined, {
            ...details,
            urlChanged: true,
          }),
        };
      context.document.load("changeTrackingMode");
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load("items/uniqueLocalId");
      await context.sync();
      if (context.document.changeTrackingMode !== "Off")
        return {
          status: "stale",
          diagnostic: diagnostic("preflight", "tracking", undefined, details),
        };
      const position = new Map(
        paragraphs.items.map((p, i) => [p.uniqueLocalId, i]),
      );
      const missing = ops.find((op) => !position.has(op.id));
      if (missing)
        return {
          status: "stale",
          diagnostic: diagnostic("preflight", "source-changed", undefined, {
            ...details,
            locations: [blockLocation(missing.ref, "missing")],
          }),
        };
      const proxies = ops.map((op) => paragraphs.items[position.get(op.id)!]);
      const reads = proxies.map((p) => p.getOoxml());
      await context.sync();
      const pending: number[] = [];
      for (const [i, op] of ops.entries()) {
        const live = wordParagraphSignature(reads[i].value);
        if (live === op.originalSignature) continue;
        if (live !== expected.get(op.id))
          return {
            status: "stale",
            diagnostic: diagnostic("preflight", "source-changed", undefined, {
              ...details,
              locations: [blockLocation(op.ref, "changed")],
            }),
          };
        pending.push(i);
      }
      const originals = encodeWordScopeFingerprint(
        ops.map((op) => [op.id, op.originalSignature]),
      );
      const outcome = {
        route: "in-place" as const,
        tier: "block" as const,
        adjustments: [],
        ops: ops.length,
      };
      if (!pending.length)
        return { status: "reverted", afterFingerprint: originals, outcome };
      stage = "restore";
      writing = true;
      pending
        .sort((a, b) => position.get(ops[b].id)! - position.get(ops[a].id)!)
        .forEach((i) =>
          queueWrite(
            proxies[i],
            ops[i],
            wordFirstRunMarks(reads[i].value),
            "revert",
          ),
        );
      await context.sync();
      stage = "verify";
      const after = proxies.map((p) => p.getOoxml());
      await context.sync();
      const signatures = after.map((r) => wordParagraphSignature(r.value));
      const differing = ops.filter(
        (op, i) => signatures[i] !== op.originalSignature,
      );
      if (differing.length)
        return {
          status: "interrupted",
          afterFingerprint: encodeWordScopeFingerprint(
            ops.map((op, i) => [op.id, signatures[i]]),
          ),
          diagnostic: diagnostic("restore", "output-mismatch", undefined, {
            ...details,
            verifyTier: "block",
            locations: differing
              .slice(0, 8)
              .map((op) => blockLocation(op.ref, "signature")),
          }),
        };
      return { status: "reverted", afterFingerprint: originals, outcome };
    });
  } catch (error) {
    return {
      status: writing ? "interrupted" : "stale",
      ...(writing ? { afterFingerprint: await observedScope() } : {}),
      diagnostic: diagnostic(stage, "host-error", error, details),
    };
  }
}
