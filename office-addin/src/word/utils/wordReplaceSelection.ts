import { wordErrorText } from "./wordApplyDiagnostics";
import { trackWordApply } from "./wordApplyProgress";
import {
  resolveWordParagraphs,
  wordParagraphAnchor,
} from "./wordParagraphResolver";
import { runWordGuarded } from "./wordRunGuard";
import { rewritableWordSelection } from "./wordSelectionAnchor";
import { currentWordSelectionSupport } from "./wordSelectionCapture";
import { splitWordSelectionReplacement } from "./wordSelectionEdit";
import {
  checkTargetVerification,
  proveWordSelectionTarget,
  queueTargetVerification,
  queueWordSections,
  readWordStory,
  wordParagraphEndsSection,
} from "./wordSelectionTarget";

import type { WordApplyStage } from "./wordApplyProgress";
import type {
  WordSelectionCapture,
  WordSelectionReplaceCode,
  WordSelectionShape,
  WordSelectionSnapshot,
} from "./wordSelectionAnchor";
import type { WordSelectionFont } from "./wordSelectionFormatting";
import type {
  WordSelectionWritten,
  WordStoryRead,
} from "./wordSelectionTarget";

/** Proof, final read and write in one run; generous because the web's OOXML reads are slow. */
export const WORD_REPLACE_SELECTION_TIMEOUT_MS = 30_000;
export const WORD_REVERT_SELECTION_TIMEOUT_MS = 30_000;

/** Undo of a Replace while Track Changes was off: the paragraph's own OOXML before the write. */
export interface WordSelectionBackup {
  ooxml: string;
  /** paragraph.text before the write, which the restore must give back. */
  rangeText: string;
}

export type WordSelectionRefusal = Exclude<
  WordSelectionReplaceCode,
  "UNVERIFIED_AFTER_WRITE"
>;

export type WordReplaceSelectionResult = (
  | {
      status: "applied";
      written: WordSelectionWritten;
      /** Null under Track Changes: Word's Reject undoes the write there. */
      backup: WordSelectionBackup | null;
      trackingOn: boolean;
    }
  /** The proposal equals the passage, so there was nothing to write. */
  | { status: "unchanged" }
  /** Nothing was written. */
  | { status: "refused"; code: WordSelectionRefusal }
  /** Nothing was written: the run failed or timed out before its write. */
  | { status: "failed"; timedOut: boolean }
  /** A write was queued, but the result could not be confirmed. */
  | { status: "unverified"; timedOut: boolean }
) & {
  /** Resolves once Word's run has ended, which after a timeout may be much later. */
  settled: Promise<void>;
};

const SETTLED = Promise.resolve();

interface Written {
  positions: number[];
  lines: string[];
  trackingOn: boolean;
  backups: string[];
}

/** Desktop's getText keeps the paragraph mark the written line lacks; Replace never writes a cell. */
const withoutMark = (text: string) => text.replace(/\r$/, "");

function setFont(range: Word.Range, font: WordSelectionFont): void {
  const target = range.font as unknown as Record<string, unknown>;
  for (const [property, value] of Object.entries(font))
    if (value !== undefined && value !== null) target[property] = value;
}

/**
 * Reads the paragraphs back in a fresh run: same-run reads after a write are wrong on the web
 * (SV2:74). With Track Changes on paragraph.text still holds the deleted text, so the identity
 * text is compared then.
 */
async function readBack(
  written: Written,
): Promise<WordSelectionWritten | null> {
  const result = await runWordGuarded(
    async (context) => readWordStory(context),
    { timeoutMs: WORD_REPLACE_SELECTION_TIMEOUT_MS },
  );
  if (result.outcome !== "ok" || !result.value) return null;
  const story: WordStoryRead = result.value;
  const matches = written.positions.every((position, i) => {
    const text = written.trackingOn
      ? withoutMark(story.entries[position]?.text ?? "")
      : story.rangeTexts[position];
    return text === written.lines[i];
  });
  if (!matches) return null;
  const first = written.positions[0];
  const last = written.positions[written.positions.length - 1];
  return {
    anchor: wordParagraphAnchor(story.entries, first, last),
    rangeTexts: written.positions.map((position) => story.rangeTexts[position]),
  };
}

function gate(
  capture: WordSelectionCapture | null | undefined,
  enabledShapes?: ReadonlySet<WordSelectionShape>,
): WordSelectionSnapshot | null {
  const selection = rewritableWordSelection(capture, enabledShapes);
  return selection && currentWordSelectionSupport().canRewrite
    ? selection
    : null;
}

/**
 * Writes the model's rewrite onto the passage captured at Send, never onto the live selection. The
 * passage must be proven unchanged in a final read that comes right before the one write sync; a
 * timeout before the write leaves the document untouched, and one after it is reported as
 * unverified, never as "nothing written".
 */
export async function replaceWordSelection(args: {
  capture: WordSelectionCapture | null | undefined;
  fenceContent: string;
  onStage?: (stage: WordApplyStage) => void;
  timeoutMs?: number;
  /** Tests only: the shapes the executor accepts. */
  enabledShapes?: ReadonlySet<WordSelectionShape>;
}): Promise<WordReplaceSelectionResult> {
  const selection = gate(args.capture, args.enabledShapes);
  if (!selection)
    return { status: "refused", code: "UNSUPPORTED_CONTENT", settled: SETTLED };
  const replacement = splitWordSelectionReplacement(
    args.fenceContent,
    selection.shape,
    selection.paragraphCount,
  );
  if ("refused" in replacement)
    return { status: "refused", code: replacement.refused, settled: SETTLED };
  const { lines } = replacement;
  const support = currentWordSelectionSupport();
  const progress = trackWordApply("selection", args.onStage);
  progress.stage("checking");

  const run = await runWordGuarded<
    Written | { refused: WordSelectionRefusal } | null
  >(
    async (context, guard) => {
      const sections = queueWordSections(context);
      const proof = await proveWordSelectionTarget(context, selection);
      if ("refused" in proof)
        return { refused: proof.refused as WordSelectionRefusal };
      // A section break may have been added after Send; the final read below cannot see it.
      for (const paragraph of proof.paragraphs)
        if (await wordParagraphEndsSection(context, sections, paragraph))
          return { refused: "UNSUPPORTED_CONTENT" };
      const verify = queueTargetVerification(context, proof.paragraphs);
      await context.sync();
      const check = checkTargetVerification(selection, verify(), support);
      if ("refused" in check)
        return { refused: check.refused as WordSelectionRefusal };
      const changed = proof.paragraphs
        .map((paragraph, i) => ({ paragraph, i }))
        .filter(({ i }) => lines[i] !== selection.paragraphs[i].rangeText);
      if (changed.length === 0) return null;
      // Nothing may be awaited between this check and the write sync.
      guard.beforeWrite();
      progress.stage("writing");
      for (const { paragraph, i } of changed.reverse())
        setFont(
          paragraph.insertText(lines[i], "Replace"),
          check.formats[i].font,
        );
      await context.sync();
      return {
        positions: proof.positions,
        lines,
        trackingOn: check.trackingOn,
        backups: check.backups,
      };
    },
    { timeoutMs: args.timeoutMs ?? WORD_REPLACE_SELECTION_TIMEOUT_MS },
  );

  const { settled } = run;
  if (run.outcome !== "ok") {
    if (run.outcome === "error")
      console.warn(
        "[erato] Word selection replace failed:",
        wordErrorText(run.error),
      );
    const timedOut = run.outcome === "timeout";
    progress.finish(run.writeQueued ? "unverified" : "failed");
    return run.writeQueued
      ? { status: "unverified", timedOut, settled }
      : { status: "failed", timedOut, settled };
  }
  const value = run.value;
  if (value === null || value === undefined) {
    progress.finish("unchanged");
    return { status: "unchanged", settled };
  }
  if ("refused" in value) {
    progress.finish(value.refused);
    return { status: "refused", code: value.refused, settled };
  }
  progress.stage("verifying");
  const written = await readBack(value);
  if (!written) {
    progress.finish("unverified");
    return { status: "unverified", timedOut: false, settled };
  }
  progress.finish("applied");
  return {
    status: "applied",
    written,
    backup: value.trackingOn
      ? null
      : {
          ooxml: value.backups[0],
          rangeText: selection.paragraphs[0].rangeText,
        },
    trackingOn: value.trackingOn,
    settled,
  };
}

export type WordSelectionRevertStatus =
  | "reverted"
  /** The written text changed since, so restoring would overwrite later work. */
  | "stale"
  | "tracking"
  | "failed"
  /** The restore was written but could not be confirmed. */
  | "unverified";

export interface WordSelectionRevertResult {
  status: WordSelectionRevertStatus;
  timedOut: boolean;
  /** Resolves once Word's run has ended, which after a timeout may be much later. */
  settled: Promise<void>;
}

/**
 * Restores the paragraph a Replace wrote from its OOXML before the write, only while it still
 * holds exactly the written text. The restore shows only in a later Word.run on the web (PF4), so
 * it is verified in one.
 */
export async function revertWordSelection(
  backup: WordSelectionBackup,
  written: WordSelectionWritten,
): Promise<WordSelectionRevertResult> {
  const run = await runWordGuarded<
    | { position: number; paragraphs: number; sections: number }
    | "stale"
    | "tracking"
  >(
    async (context, guard) => {
      context.document.load("changeTrackingMode");
      const sections = queueWordSections(context);
      const story = await readWordStory(context);
      if (context.document.changeTrackingMode !== "Off") return "tracking";
      const resolved = resolveWordParagraphs(written.anchor, story.entries);
      if ("refused" in resolved) return "stale";
      const position = resolved.positions[0];
      if (story.rangeTexts[position] !== written.rangeTexts[0]) return "stale";
      if (
        await wordParagraphEndsSection(context, sections, story.items[position])
      )
        return "stale";
      guard.beforeWrite();
      story.items[position].insertOoxml(backup.ooxml, "Replace");
      await context.sync();
      return {
        position,
        paragraphs: story.items.length,
        sections: sections.items.length,
      };
    },
    { timeoutMs: WORD_REVERT_SELECTION_TIMEOUT_MS },
  );
  const { settled } = run;
  const timedOut = run.outcome === "timeout";
  if (run.outcome !== "ok" || !run.value) {
    if (run.outcome === "error")
      console.warn(
        "[erato] Word selection undo failed:",
        wordErrorText(run.error),
      );
    return {
      status: run.writeQueued ? "unverified" : "failed",
      timedOut,
      settled,
    };
  }
  const value = run.value;
  if (value === "stale" || value === "tracking")
    return { status: value, timedOut, settled };
  const check = await runWordGuarded(
    async (context) => {
      const sections = context.document.sections;
      sections.load("items");
      const story = await readWordStory(context);
      return { story, sections: sections.items.length };
    },
    { timeoutMs: WORD_REVERT_SELECTION_TIMEOUT_MS },
  );
  // A restore that added a paragraph or a section, as insertOoxml can at the end of a body or a
  // section, did not give the paragraph back as it was.
  const restored =
    check.outcome === "ok" &&
    !!check.value &&
    check.value.story.rangeTexts[value.position] === backup.rangeText &&
    check.value.story.items.length === value.paragraphs &&
    check.value.sections === value.sections;
  return {
    status: restored ? "reverted" : "unverified",
    timedOut,
    settled,
  };
}
