import {
  buildWordEditReport,
  planWordEdits,
  verifyWordEdits,
} from "./wordEditPlan";
import { wordWriteHost } from "./wordWriteHost";

import type { WordDocumentCapture } from "./wordDocumentCapture";
import type { WordEdit, WordEditOutcome } from "./wordEditPlan";
import type { WordReviewAnchor } from "./wordReviewLocation";

export interface WordApplyResult {
  outcomes: WordEditOutcome[];
  /** Preserve the backup after a rejected batch: earlier queued writes may already have applied. */
  snapshotOoxml: string | null;
  hostFailed: boolean;
  resultAnchors?: ReadonlyMap<number, WordReviewAnchor>;
}

/** Load IDs as a collection: resolving a deleted ID directly rejects the whole sync.
 * Apply last-to-first because inserted paragraphs shift collection positions. */
export async function applyWordEdits(args: {
  edits: readonly WordEdit[];
  capture: WordDocumentCapture;
}): Promise<WordApplyResult> {
  const { edits, capture } = args;
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
    return await word.run(async (context) => {
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
        const snapshot = context.document.body.getOoxml();
        await context.sync();
        snapshotOoxml = snapshot.value;

        for (const edit of verified.applicable) {
          writeReplacement(context, edit.targets, edit.text);
        }
        await context.sync();
      } catch (error) {
        console.warn("Failed to write Word edits:", error);
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
        hostFailed: false,
        resultAnchors,
      };
    });
  } catch (error) {
    console.warn("Failed to apply Word edits:", error);
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

/** Restore the whole body because inserted newlines invalidate the original paragraph positions. */
export async function revertWordEdits(snapshotOoxml: string): Promise<boolean> {
  const word = wordWriteHost();
  if (!word) return false;
  try {
    await word.run(async (context) => {
      context.document.body.insertOoxml(snapshotOoxml, "Replace");
      await context.sync();
    });
    return true;
  } catch (error) {
    console.warn("Failed to revert Word edits:", error);
    return false;
  }
}
