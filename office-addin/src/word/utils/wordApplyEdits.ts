import { wordErrorText } from "./wordApplyDiagnostics";
import { trackWordApply } from "./wordApplyProgress";
import { wordDocumentFingerprint } from "./wordDocumentXml";
import {
  buildWordEditReport,
  planWordEdits,
  verifyWordEdits,
} from "./wordEditPlan";
import { wordWriteHost } from "./wordWriteHost";

import type { WordApplyProgress, WordApplyStage } from "./wordApplyProgress";
import type { WordDocumentCapture } from "./wordDocumentCapture";
import type { WordEdit, WordEditOutcome } from "./wordEditPlan";
import type { WordReviewAnchor } from "./wordReviewLocation";

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

/** Load IDs as a collection: resolving a deleted ID directly rejects the whole sync.
 * Apply last-to-first because inserted paragraphs shift collection positions. */
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
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load("items/uniqueLocalId");
      await context.sync();

      const targetIds = new Set(
        plan.resolved.flatMap((edit) =>
          edit.targets.map((target) => target.uniqueLocalId),
        ),
      );
      const pending = new Map<string, ReturnType<Word.Paragraph["getText"]>>();
      for (const paragraph of paragraphs.items) {
        if (targetIds.has(paragraph.uniqueLocalId)) {
          pending.set(paragraph.uniqueLocalId, paragraph.getText());
        }
      }
      await context.sync();

      const currentTextById = new Map<string, string | null>();
      for (const id of targetIds) {
        currentTextById.set(id, pending.get(id)?.value ?? null);
      }

      const verified = verifyWordEdits(
        plan,
        currentTextById,
        paragraphs.items.map((p) => p.uniqueLocalId),
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
          writeReplacement(context, edit.targets, edit.text);
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
          const after = context.document.body.paragraphs;
          after.load("items/uniqueLocalId");
          await context.sync();
          const candidateIds = new Set(
            candidates.map((edit) => edit.targets[0].uniqueLocalId),
          );
          const texts = new Map(
            after.items
              .filter((p) => candidateIds.has(p.uniqueLocalId))
              .map((p) => [p.uniqueLocalId, p.getText()]),
          );
          await context.sync();
          for (const edit of candidates) {
            const id = edit.targets[0].uniqueLocalId;
            if (texts.get(id)?.value === edit.text) {
              resultAnchors.set(edit.index, {
                identity: capture.identity,
                paragraphs: [{ uniqueLocalId: id, text: edit.text }],
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
  context: Word.RequestContext,
  targets: readonly { uniqueLocalId: string }[],
  text: string,
): void {
  for (let index = targets.length - 1; index >= 1; index -= 1) {
    context.document
      .getParagraphByUniqueLocalId(targets[index].uniqueLocalId)
      .delete();
  }
  context.document
    .getParagraphByUniqueLocalId(targets[0].uniqueLocalId)
    // Word.InsertLocation is a runtime SDK object; use its literal value.
    .insertText(text, "Replace");
}

export type WordEditsRevertStatus = "reverted" | "stale" | "failed";

/** Restore the whole body because inserted newlines invalidate the original paragraph positions.
 * Refused while Track Changes is on (the restore would land as revisions) or once the body differs
 * from what the batch left, which would overwrite later edits. */
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
      if (
        context.document.changeTrackingMode !== "Off" ||
        wordBodyFingerprint(live.value) !== expectedAfter
      )
        return "stale";
      context.document.body.insertOoxml(snapshotOoxml, "Replace");
      await context.sync();
      return "reverted";
    });
  } catch (error) {
    console.warn("Failed to revert Word edits:", wordErrorText(error));
    return "failed";
  }
}
