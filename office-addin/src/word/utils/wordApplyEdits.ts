import {
  buildWordEditReport,
  planWordEdits,
} from "@erato/frontend/word-review";

import { wordErrorText } from "./wordApplyDiagnostics";
import { trackWordApply } from "./wordApplyProgress";
import { wordBodyFingerprint } from "./wordDocumentXml";
import {
  wordHostPlatform,
  wordParagraphOoxmlHasProperties,
} from "./wordHostPlatform";
import { isWordTrackingMode } from "./wordInPlaceSwitch";
import {
  resolveWordParagraphs,
  wordParagraphAnchor,
} from "./wordParagraphResolver";
import {
  capturedWordAnchor,
  readWordParagraphEntries,
} from "./wordReviewLocation";
import {
  wordParagraphRevisionAuthors,
  wordRevisionAuthor,
} from "./wordRevisionViews";
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
function bodyFingerprintOrRaw(ooxml: string): string {
  try {
    return wordBodyFingerprint(ooxml);
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
      return bodyFingerprintOrRaw(body.value);
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

/** Relations of a listed change that place it clear of a paragraph; any other counts as in it. */
const CLEAR_OF = new Set([
  "Before",
  "AdjacentBefore",
  "After",
  "AdjacentAfter",
  "Unrelated",
]);

/** Per paragraph, the authors of the changes Word lists in it, or null when it lists none. Word for
 * the web leaves w:pPr out of Paragraph.getOoxml, so a revised paragraph mark or paragraph format
 * shows only here. `type` stays unloaded: it throws on moves. */
async function listedRevisionAuthors(
  context: Word.RequestContext,
  paragraphs: readonly Word.Paragraph[],
): Promise<(string[] | null)[]> {
  const changes = context.document.body.getTrackedChanges();
  changes.load("items/author");
  await context.sync();
  if (changes.items.length === 0) return paragraphs.map(() => null);
  const relations = paragraphs.map((paragraph) => {
    const whole = paragraph.getRange("Whole");
    return changes.items.map((change) =>
      change.getRange("Whole").compareLocationWith(whole),
    );
  });
  await context.sync();
  return relations.map((row) => {
    const held = changes.items.filter((_, k) => !CLEAR_OF.has(row[k].value));
    return held.length
      ? held.map((change) => wordRevisionAuthor(change.author)).filter(Boolean)
      : null;
  });
}

/** A Replace accepts or absorbs a paragraph's pending revisions, and Office.js cannot tell the user's
 * own from others', so any revision refuses the edit; read from OOXML, as a paragraph's
 * getTrackedChanges() misses some. Under Track Changes a Replace is a whole-paragraph revision Revert cannot undo. */
async function withoutRevisedParagraphs(
  context: Word.RequestContext,
  items: readonly Word.Paragraph[],
  verified: { applicable: PositionedWordEdit[]; skipped: WordEditOutcome[] },
  tracking: boolean,
): Promise<{ applicable: PositionedWordEdit[]; skipped: WordEditOutcome[] }> {
  const positions = [
    ...new Set(verified.applicable.flatMap((edit) => edit.positions)),
  ];
  if (positions.length === 0) return verified;
  const packages = positions.map((position) => items[position].getOoxml());
  await context.sync();
  const listed = wordParagraphOoxmlHasProperties(wordHostPlatform())
    ? []
    : await listedRevisionAuthors(
        context,
        positions.map((position) => items[position]),
      );
  const authors = new Map(
    positions.map((position, i) => {
      const found = wordParagraphRevisionAuthors(packages[i].value);
      const more = listed[i];
      return [
        position,
        found || more
          ? [...new Set([...(found ?? []), ...(more ?? [])])]
          : null,
      ];
    }),
  );
  const applicable: PositionedWordEdit[] = [];
  const skipped = [...verified.skipped];
  for (const edit of verified.applicable) {
    const held = edit.positions.flatMap((p) => authors.get(p) ?? []);
    const revised = edit.positions.some((p) => authors.get(p));
    if (!revised && !tracking) {
      applicable.push(edit);
      continue;
    }
    skipped.push({
      index: edit.index,
      paragraph: edit.paragraph,
      ...(edit.through === undefined ? {} : { through: edit.through }),
      status: revised ? "revisions" : "tracking",
      excerpt: edit.excerpt,
      ...(revised ? { authors: [...new Set(held)] } : {}),
    });
  }
  return { applicable, skipped };
}

/** The written paragraph after the batch: by its ID where Word has one, else by its new text alone.
 * Desktop getText keeps the paragraph or cell mark that the written text lacks. */
function writtenPosition(
  id: string | null,
  text: string,
  after: readonly WordParagraphEntry[],
): number | null {
  const matches = after
    .map((p, i) =>
      (id ? p.id === id : true) && p.text.replace(/[\r\t\u0007]$/u, "") === text
        ? i
        : -1,
    )
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
      context.document.load("changeTrackingMode");
      const { items, entries } = await readWordParagraphEntries(context);
      const verified = await withoutRevisedParagraphs(
        context,
        items,
        resolveWordEdits(plan, capture, entries),
        !!capture.trackChanges ||
          isWordTrackingMode(context.document.changeTrackingMode),
      );
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
        afterFingerprint = bodyFingerprintOrRaw(after.value);
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
      if (bodyFingerprintOrRaw(live.value) !== expectedAfter) return "stale";
      context.document.body.insertOoxml(snapshotOoxml, "Replace");
      await context.sync();
      return "reverted";
    });
  } catch (error) {
    console.warn("Failed to revert Word edits:", wordErrorText(error));
    return "failed";
  }
}
