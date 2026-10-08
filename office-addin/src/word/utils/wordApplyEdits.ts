import {
  buildWordEditReport,
  planWordEdits,
} from "@erato/frontend/word-review";

import { wordErrorText } from "./wordApplyDiagnostics";
import { trackWordApply } from "./wordApplyProgress";
import { wordDocumentFingerprint } from "./wordDocumentXml";
import {
  resolveWordParagraphs,
  wordParagraphAnchor,
} from "./wordParagraphResolver";
import {
  capturedWordAnchor,
  readWordParagraphEntries,
} from "./wordReviewLocation";
import { wordWriteHost } from "./wordWriteHost";

import type { WordApplyProgress, WordApplyStage } from "./wordApplyProgress";
import type { WordParagraphEntry } from "./wordParagraphResolver";
import type { WordReviewAnchor } from "./wordReviewLocation";
import type {
  ResolvedWordEdit,
  WordDocumentCapture,
  WordEdit,
  WordEditOutcome,
  WordEditPlan,
} from "@erato/frontend/word-review";

export interface WordApplyResult {
  outcomes: WordEditOutcome[];
  /** Preserve the backup after a rejected batch: earlier queued writes may already have applied. */
  snapshotOoxml: string | null;
  /** The body as the batch left it; Revert runs only while the body still matches. */
  afterFingerprint?: string;
  hostFailed: boolean;
  resultAnchors?: ReadonlyMap<number, WordReviewAnchor>;
}

/** A body Word returns as something other than a package is compared verbatim. */
function wordBodyFingerprint(ooxml: string): string {
  try {
    return wordDocumentFingerprint(ooxml);
  } catch {
    return `raw:${ooxml}`;
  }
}

/** Read in a fresh batch after a rejected write; never retry it. */
async function observeWordBody(
  word: NonNullable<ReturnType<typeof wordWriteHost>>,
): Promise<string | undefined> {
  try {
    return await word.run(async (context) => {
      const body = context.document.body.getOoxml();
      await context.sync();
      return wordBodyFingerprint(body.value);
    });
  } catch {
    return undefined;
  }
}

interface PositionedWordEdit extends ResolvedWordEdit {
  positions: number[];
}

/** Each edit's captured span located in the live body; a paragraph claimed twice is not written twice.
 * Survivors come last-to-first, the order they are written in. */
function resolveWordEdits(
  plan: WordEditPlan,
  capture: WordDocumentCapture,
  live: readonly WordParagraphEntry[],
): { applicable: PositionedWordEdit[]; skipped: WordEditOutcome[] } {
  const applicable: PositionedWordEdit[] = [];
  const skipped: WordEditOutcome[] = [];
  const claimed = new Set<number>();
  for (const edit of plan.resolved) {
    const anchor = capturedWordAnchor(
      capture,
      edit.targets[0].ordinal,
      edit.targets[edit.targets.length - 1].ordinal,
    );
    const resolved = anchor
      ? resolveWordParagraphs(anchor.span, live)
      : ({ refused: "changed" } as const);
    if (
      "positions" in resolved &&
      !resolved.positions.some((p) => claimed.has(p))
    ) {
      resolved.positions.forEach((p) => claimed.add(p));
      applicable.push({ ...edit, positions: resolved.positions });
    } else {
      skipped.push({
        index: edit.index,
        paragraph: edit.paragraph,
        ...(edit.through === undefined ? {} : { through: edit.through }),
        status: "refused" in resolved ? resolved.refused : "ambiguous",
        excerpt: edit.excerpt,
      });
    }
  }
  applicable.sort((a, b) => b.positions[0] - a.positions[0]);
  return { applicable, skipped };
}

/** The written paragraph after the batch: by its ID where Word has one, else by its new text alone. */
function writtenPosition(
  id: string | null,
  text: string,
  after: readonly WordParagraphEntry[],
): number | null {
  const matches = after
    .map((p, i) => ((id ? p.id === id : true) && p.text === text ? i : -1))
    .filter((i) => i >= 0);
  return matches.length === 1 ? matches[0] : null;
}

export async function applyWordEdits(args: {
  edits: readonly WordEdit[];
  capture: WordDocumentCapture;
  onStage?: (stage: WordApplyStage) => void;
}): Promise<WordApplyResult> {
  const progress = trackWordApply("edits", args.onStage);
  let result: WordApplyResult | undefined;
  try {
    result = await applyEdits(args.edits, args.capture, progress);
    return result;
  } finally {
    progress.finish(
      !result ? "error" : result.hostFailed ? "host-failed" : "completed",
    );
  }
}

async function applyEdits(
  edits: readonly WordEdit[],
  capture: WordDocumentCapture,
  progress: WordApplyProgress,
): Promise<WordApplyResult> {
  progress.stage("checking");
  const plan = planWordEdits(edits, capture);

  const failure = (outcomes: WordEditOutcome[]): WordApplyResult => ({
    outcomes: buildWordEditReport(outcomes),
    snapshotOoxml: null,
    hostFailed: true,
  });

  const word = wordWriteHost();
  if (!word) {
    return failure([
      ...plan.rejected,
      ...plan.resolved.map(
        (edit): WordEditOutcome => ({
          index: edit.index,
          paragraph: edit.paragraph,
          ...(edit.through === undefined ? {} : { through: edit.through }),
          status: "failed",
          excerpt: edit.excerpt,
        }),
      ),
    ]);
  }

  try {
    const result = await word.run(async (context) => {
      const { items, entries } = await readWordParagraphEntries(context);
      const verified = resolveWordEdits(plan, capture, entries);
      if (verified.applicable.length === 0) {
        return {
          outcomes: buildWordEditReport([
            ...plan.rejected,
            ...verified.skipped,
          ]),
          snapshotOoxml: null,
          hostFailed: false,
        };
      }

      let snapshotOoxml: string | null = null;
      try {
        progress.stage("backup");
        const snapshot = context.document.body.getOoxml();
        await context.sync();
        snapshotOoxml = snapshot.value;

        progress.stage("writing");
        for (const edit of verified.applicable) {
          writeReplacement(items, edit.positions, edit.text);
        }
        await context.sync();
      } catch (error) {
        console.warn("Failed to write Word edits:", wordErrorText(error));
        return {
          outcomes: buildWordEditReport([
            ...plan.rejected,
            ...verified.skipped,
            ...verified.applicable.map(
              (edit): WordEditOutcome => ({
                index: edit.index,
                paragraph: edit.paragraph,
                ...(edit.through === undefined
                  ? {}
                  : { through: edit.through }),
                status: "failed",
                excerpt: edit.excerpt,
              }),
            ),
          ]),
          snapshotOoxml,
          hostFailed: true,
        };
      }

      const resultAnchors = new Map<number, WordReviewAnchor>();
      progress.stage("verifying");
      let afterFingerprint: string | undefined;
      try {
        const after = context.document.body.getOoxml();
        await context.sync();
        afterFingerprint = wordBodyFingerprint(after.value);
      } catch {
        // Without the post-write body, Revert stays unavailable rather than unguarded.
      }
      try {
        const candidates = verified.applicable.filter(
          (edit) => edit.targets.length === 1 && !/[\r\n\v\f]/u.test(edit.text),
        );
        if (candidates.length > 0) {
          const after = (await readWordParagraphEntries(context)).entries;
          for (const edit of candidates) {
            const position = writtenPosition(
              entries[edit.positions[0]].id,
              edit.text,
              after,
            );
            if (position !== null) {
              resultAnchors.set(edit.index, {
                identity: capture.identity,
                span: wordParagraphAnchor(after, position, position),
              });
            }
          }
        }
      } catch {
        // Navigation failure must not change the successful write result.
      }

      return {
        outcomes: buildWordEditReport([
          ...plan.rejected,
          ...verified.skipped,
          ...verified.applicable.map(
            (edit): WordEditOutcome => ({
              index: edit.index,
              paragraph: edit.paragraph,
              ...(edit.through === undefined ? {} : { through: edit.through }),
              status: "applied",
              excerpt: edit.excerpt,
            }),
          ),
        ]),
        snapshotOoxml,
        afterFingerprint,
        hostFailed: false,
        resultAnchors,
      };
    });
    return result.hostFailed && result.snapshotOoxml
      ? { ...result, afterFingerprint: await observeWordBody(word) }
      : result;
  } catch (error) {
    console.warn("Failed to apply Word edits:", wordErrorText(error));
    return failure([
      ...plan.rejected,
      ...plan.resolved.map(
        (edit): WordEditOutcome => ({
          index: edit.index,
          paragraph: edit.paragraph,
          ...(edit.through === undefined ? {} : { through: edit.through }),
          status: "failed",
          excerpt: edit.excerpt,
        }),
      ),
    ]);
  }
}

/** Delete trailing paragraphs first, then replace the head to retain its style. */
function writeReplacement(
  items: readonly Word.Paragraph[],
  positions: readonly number[],
  text: string,
): void {
  for (let index = positions.length - 1; index >= 1; index -= 1) {
    items[positions[index]].delete();
  }
  // Word.InsertLocation is a runtime SDK object; use its literal value.
  items[positions[0]].insertText(text, "Replace");
}

export type WordEditsRevertStatus =
  | "reverted"
  | "stale"
  | "tracking"
  | "failed";

/** Restore the whole body because inserted newlines invalidate the original paragraph positions.
 * Refused while Track Changes is on ("tracking": the restore would land as revisions) or once the
 * body differs from what the batch left ("stale"), which would overwrite later edits. */
export async function revertWordEdits(
  snapshotOoxml: string,
  expectedAfter: string | undefined,
): Promise<WordEditsRevertStatus> {
  const word = wordWriteHost();
  if (!word) return "failed";
  if (!expectedAfter) return "stale";
  try {
    return await word.run(async (context) => {
      context.document.load("changeTrackingMode");
      const live = context.document.body.getOoxml();
      await context.sync();
      if (context.document.changeTrackingMode !== "Off") return "tracking";
      if (wordBodyFingerprint(live.value) !== expectedAfter) return "stale";
      context.document.body.insertOoxml(snapshotOoxml, "Replace");
      await context.sync();
      return "reverted";
    });
  } catch (error) {
    console.warn("Failed to revert Word edits:", wordErrorText(error));
    return "failed";
  }
}
