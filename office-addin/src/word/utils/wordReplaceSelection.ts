import { wordErrorText } from "./wordApplyDiagnostics";
import { trackWordApply } from "./wordApplyProgress";
import { wordHostPlatform } from "./wordHostPlatform";
import {
  resolveWordParagraphs,
  wordParagraphAnchor,
} from "./wordParagraphResolver";
import { runWordGuarded } from "./wordRunGuard";
import {
  rewritableWordSelection,
  wordIdentityShows,
  wordSelectionPartOffsets,
  wordSelectionParts,
} from "./wordSelectionAnchor";
import { WORD_SELECTION_SPAN_CHECK_MS_PER_PARAGRAPH } from "./wordSelectionCapture";
import {
  splitWordSelectionReplacement,
  wordSelectionLinePieces,
} from "./wordSelectionEdit";
import {
  readWordParagraphItems,
  wordKeptItemsShape,
} from "./wordSelectionItems";
import { rewriteWordParagraphPart } from "./wordSelectionRewrite";
import {
  currentWordSelectionSupport,
  WORD_WEB_REVERT_MAX_PARAGRAPHS,
} from "./wordSelectionSupport";
import {
  checkTargetVerification,
  proveWordSelectionTarget,
  queueTargetVerification,
  queueWordCellTable,
  queueWordSections,
  readWordStory,
  sameCellTable,
  wordParagraphsEndingSection,
  queueParagraphSpanChecks,
} from "./wordSelectionTarget";

import type { WordApplyStage } from "./wordApplyProgress";
import type { WordHostPlatform } from "./wordHostPlatform";
import type {
  WordSelectionCapture,
  WordSelectionReplaceCode,
  WordSelectionShape,
  WordSelectionSnapshot,
} from "./wordSelectionAnchor";
import type { WordSelectionFont } from "./wordSelectionFormatting";
import type { WordParagraphRewrite } from "./wordSelectionRewrite";
import type {
  WordCellTable,
  WordSelectionWritten,
  WordStoryRead,
} from "./wordSelectionTarget";

/**
 * Proof, final read and write in one run; generous because the web's OOXML reads are slow. Each
 * covered paragraph adds the capture's span-check allowance, since the final read repeats them.
 */
export const WORD_REPLACE_SELECTION_TIMEOUT_MS = 30_000;
export const WORD_REVERT_SELECTION_TIMEOUT_MS = 30_000;
/**
 * Added to the restore run per restored paragraph. A one-paragraph restore took 4.5-7.6 s on the
 * web, mostly its write sync; restores of more than 3 paragraphs are not measured there.
 */
export const WORD_REVERT_SELECTION_MS_PER_PARAGRAPH = 1_000;
export { WORD_WEB_REVERT_MAX_PARAGRAPHS } from "./wordSelectionSupport";

export function isWordRevertOffered(
  paragraphs: number,
  platform: WordHostPlatform = wordHostPlatform(),
): boolean {
  return (
    platform !== "OfficeOnline" || paragraphs <= WORD_WEB_REVERT_MAX_PARAGRAPHS
  );
}

/** Undo of a Replace while Track Changes was off: a written paragraph's own OOXML before the write. */
export interface WordSelectionBackup {
  /** Index among the paragraphs the Replace covered. */
  position: number;
  ooxml: string;
  /** paragraph.text before the write, which the restore must give back. */
  rangeText: string;
  /** 0 outside tables; a restore in a cell must leave its table's rows and cells as they were. */
  tableNestingLevel: number;
}

export type WordSelectionRefusal = Exclude<
  WordSelectionReplaceCode,
  "UNVERIFIED_AFTER_WRITE"
>;

export type WordReplaceSelectionResult = (
  | {
      status: "applied";
      written: WordSelectionWritten;
      /**
       * One per paragraph written, in document order. Null under Track Changes: Word's Reject
       * undoes the write there.
       */
      backups: WordSelectionBackup[] | null;
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
  /** Each paragraph's whole text once written: its text before and after the part kept. */
  expected: string[];
  /** The story's paragraph count before the write, which a Replace never changes. */
  paragraphCount: number;
  /** Per covered paragraph in a table cell, its table before the write. */
  cellTables: (WordCellTable | null)[];
  trackingOn: boolean;
  backups: WordSelectionBackup[];
  startOffset: number;
  endOffset: number;
  /** Per covered paragraph written as OOXML, its items before the write; null for the others. */
  items: (string | null)[];
}

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
    async (context) => {
      const story = await readWordStory(context);
      const cells = written.cellTables.map((before, i) => {
        const paragraph = story.items[written.positions[i]];
        return before && paragraph ? queueWordCellTable(paragraph) : null;
      });
      const ooxml = written.items.map((items, i) => {
        const paragraph = story.items[written.positions[i]];
        return items !== null && paragraph
          ? queueParagraphSpanChecks(paragraph, written.cellTables[i] !== null)
          : null;
      });
      if (cells.some(Boolean) || ooxml.some(Boolean)) await context.sync();
      return {
        story,
        cells: cells.map((cell) => cell?.() ?? null),
        items: ooxml.map((checks, i) => {
          if (!checks) return null;
          const read = readWordParagraphItems(
            checks().ooxml,
            story.rangeTexts[written.positions[i]],
          );
          return "items" in read ? wordKeptItemsShape(read.items) : "";
        }),
      };
    },
    { timeoutMs: WORD_REPLACE_SELECTION_TIMEOUT_MS },
  );
  if (result.outcome !== "ok" || !result.value) return null;
  const story: WordStoryRead = result.value.story;
  const { cells } = result.value;
  // Every kept item must still be there, as it was, and nothing in its place.
  if (
    written.items.some(
      (items, i) => items !== null && result.value!.items[i] !== items,
    )
  )
    return null;
  if (story.items.length !== written.paragraphCount) return null;
  if (
    written.cellTables.some((before, i) => {
      const after = cells[i];
      return before !== null && (!after || !sameCellTable(before, after));
    })
  )
    return null;
  const matches = written.positions.every((position, i) => {
    if (!written.trackingOn)
      return story.rangeTexts[position] === written.expected[i];
    return wordIdentityShows(
      story.entries[position]?.text ?? "",
      written.expected[i],
      written.cellTables[i] !== null,
    );
  });
  if (!matches) return null;
  const first = written.positions[0];
  const last = written.positions[written.positions.length - 1];
  return {
    anchor: wordParagraphAnchor(story.entries, first, last),
    rangeTexts: written.positions.map((position) => story.rangeTexts[position]),
    startOffset: written.startOffset,
    endOffset: written.endOffset,
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
  const marked = wordSelectionLinePieces(selection.paragraphs, lines);
  if ("refused" in marked)
    return { status: "refused", code: marked.refused, settled: SETTLED };
  const covered = wordSelectionParts(selection);
  // What each paragraph's line replaces: the part, or the part with markers where it keeps items.
  const current = selection.paragraphs.map(
    (p, i) => p.kept?.text ?? covered[i],
  );
  const offsets = wordSelectionPartOffsets(selection);
  const support = currentWordSelectionSupport();
  const progress = trackWordApply("selection", args.onStage);
  progress.stage("checking");

  const run = await runWordGuarded<
    Written | { refused: WordSelectionRefusal } | null
  >(
    async (context, guard) => {
      const sections = queueWordSections(context);
      const proof = await proveWordSelectionTarget(
        context,
        selection,
        support,
        args.enabledShapes,
      );
      if ("refused" in proof)
        return { refused: proof.refused as WordSelectionRefusal };
      // A section break may have been added after Send; the final read below cannot see it.
      const ends = await wordParagraphsEndingSection(
        context,
        sections,
        proof.paragraphs,
      );
      if (ends.some(Boolean)) return { refused: "UNSUPPORTED_CONTENT" };
      const verify = queueTargetVerification(
        context,
        proof.parts,
        selection.paragraphs,
        support,
      );
      await context.sync();
      const check = checkTargetVerification(selection, verify(), support);
      if ("refused" in check)
        return { refused: check.refused as WordSelectionRefusal };
      const changed = proof.parts
        .map((part, i) => ({ part, i }))
        .filter(({ i }) => lines[i] !== current[i]);
      if (changed.length === 0) return null;
      // A paragraph that keeps items is rewritten in its own OOXML, read in this final read.
      const rewrites = new Map<number, WordParagraphRewrite>();
      for (const { i } of changed) {
        const pieces = marked.pieces[i];
        if (!pieces) continue;
        const rewrite = rewriteWordParagraphPart(
          check.backups[i],
          selection.paragraphs[i].rangeText,
          offsets[i].start,
          offsets[i].end,
          pieces,
        );
        if (!rewrite) return { refused: "UNSUPPORTED_CONTENT" };
        rewrites.set(i, rewrite);
      }
      // Nothing may be awaited between this check and the write sync.
      guard.beforeWrite();
      progress.stage("writing");
      // Last to first, so no write moves a paragraph a later one targets: one sync, one Undo step.
      for (const { part, i } of [...changed].reverse()) {
        const rewrite = rewrites.get(i);
        if (rewrite) part.paragraph.insertOoxml(rewrite.ooxml, "Replace");
        else
          setFont(
            (part.kind === "part" ? part.range : part.paragraph).insertText(
              lines[i],
              "Replace",
            ),
            check.formats[i]!.font,
          );
      }
      await context.sync();
      const expected = selection.paragraphs.map(
        ({ rangeText, kept }, i) =>
          rewrites.get(i)?.rangeText ??
          (kept
            ? rangeText
            : rangeText.slice(0, offsets[i].start) +
              lines[i] +
              rangeText.slice(offsets[i].end)),
      );
      const last = lines.length - 1;
      return {
        positions: proof.positions,
        expected,
        paragraphCount: proof.story.items.length,
        cellTables: check.cellTables,
        trackingOn: check.trackingOn,
        backups: changed.map(({ i }) => ({
          position: i,
          ooxml: check.backups[i],
          rangeText: selection.paragraphs[i].rangeText,
          tableNestingLevel: selection.paragraphs[i].tableNestingLevel,
        })),
        startOffset: offsets[0].start,
        endOffset:
          expected[last].length -
          (selection.paragraphs[last].rangeText.length - offsets[last].end),
        items: selection.paragraphs.map((p, i) => {
          if (!rewrites.has(i)) return null;
          const read = readWordParagraphItems(check.backups[i], p.rangeText);
          return "items" in read ? wordKeptItemsShape(read.items) : null;
        }),
      };
    },
    {
      timeoutMs:
        args.timeoutMs ??
        WORD_REPLACE_SELECTION_TIMEOUT_MS +
          selection.paragraphs.length *
            WORD_SELECTION_SPAN_CHECK_MS_PER_PARAGRAPH,
    },
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
    backups: value.trackingOn ? null : value.backups,
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
 * Restores the paragraphs a Replace wrote from their OOXML before the write, only while every
 * covered paragraph still holds exactly the written text. All are restored in one sync, last to
 * first, so Word's own Undo takes them back in one step too. The restore shows only in a later
 * Word.run on the web (PF4), so it is verified in one.
 */
export async function revertWordSelection(
  backups: readonly WordSelectionBackup[],
  written: WordSelectionWritten,
): Promise<WordSelectionRevertResult> {
  const run = await runWordGuarded<
    | {
        positions: number[];
        paragraphs: number;
        sections: number;
        cellTables: (WordCellTable | null)[];
      }
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
      const { positions } = resolved;
      if (
        backups.length === 0 ||
        positions.length !== written.rangeTexts.length ||
        positions.some(
          (position, i) => story.rangeTexts[position] !== written.rangeTexts[i],
        ) ||
        backups.some((backup) => positions[backup.position] === undefined)
      )
        return "stale";
      const targets = backups.map((backup) => ({
        backup,
        paragraph: story.items[positions[backup.position]],
      }));
      const ends = await wordParagraphsEndingSection(
        context,
        sections,
        targets.map(({ paragraph }) => paragraph),
      );
      if (ends.some(Boolean)) return "stale";
      const cells = targets.map(({ backup, paragraph }) =>
        backup.tableNestingLevel > 0 ? queueWordCellTable(paragraph) : null,
      );
      if (cells.some(Boolean)) await context.sync();
      const cellTables = cells.map((cell) => cell?.() ?? null);
      guard.beforeWrite();
      for (const { backup, paragraph } of [...targets].reverse())
        paragraph.insertOoxml(backup.ooxml, "Replace");
      await context.sync();
      return {
        positions,
        paragraphs: story.items.length,
        sections: sections.items.length,
        cellTables,
      };
    },
    {
      timeoutMs:
        WORD_REVERT_SELECTION_TIMEOUT_MS +
        backups.length * WORD_REVERT_SELECTION_MS_PER_PARAGRAPH,
    },
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
      const cells = backups.map((backup, i) => {
        const paragraph = story.items[value.positions[backup.position]];
        return value.cellTables[i] && paragraph
          ? queueWordCellTable(paragraph)
          : null;
      });
      if (cells.some(Boolean)) await context.sync();
      return {
        story,
        sections: sections.items.length,
        cellTables: cells.map((cell) => cell?.() ?? null),
      };
    },
    { timeoutMs: WORD_REVERT_SELECTION_TIMEOUT_MS },
  );
  // A restore that added a paragraph or a section, as insertOoxml can at the end of a body, a
  // section or a cell, did not give the paragraphs back as they were.
  const after = check.outcome === "ok" ? check.value : undefined;
  const restored =
    !!after &&
    after.story.items.length === value.paragraphs &&
    after.sections === value.sections &&
    backups.every((backup, i) => {
      const before = value.cellTables[i];
      const cell = after.cellTables[i];
      return (
        after.story.rangeTexts[value.positions[backup.position]] ===
          backup.rangeText &&
        (before === null || (!!cell && sameCellTable(before, cell)))
      );
    });
  return {
    status: restored ? "reverted" : "unverified",
    timedOut,
    settled,
  };
}
