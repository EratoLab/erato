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
  /** One line per edit, in the order the model wrote them. */
  outcomes: WordEditOutcome[];
  /**
   * Original body OOXML, retained before a write and returned even if it fails.
   * Office.js may apply some commands before rejecting the batch, so failures
   * also need recovery. Null if no snapshot was acquired; pane memory only.
   */
  snapshotOoxml: string | null;
  /** True when the host was unreachable or the batch threw. */
  hostFailed: boolean;
  /** Exact post-write locations, when the entire resulting span is known. */
  resultAnchors?: ReadonlyMap<number, WordReviewAnchor>;
}

/**
 * Verify send-time text, snapshot the body, then write by stable paragraph ID
 * in descending document order. Newlines can change collection indexes.
 *
 * Load IDs as a collection: resolving a deleted ID directly would abort the
 * entire sync instead of reporting that target as changed. Take no snapshot
 * when no edits survive verification. Attempt result anchors after writing.
 *
 * writeReplacement retains the first paragraph and delegates formatting
 * inheritance to Word; jsdom cannot verify that native behavior. A rejected
 * write reports its queued edits as failed, preserving prior skipped outcomes.
 */
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
      // Spelled through `ReturnType` rather than `OfficeExtension.ClientResult`
      // so the file names only the `Word` namespace, the one global the lint
      // config declares.
      const pending = new Map<string, ReturnType<Word.Paragraph["getText"]>>();
      for (const paragraph of paragraphs.items) {
        if (targetIds.has(paragraph.uniqueLocalId)) {
          pending.set(paragraph.uniqueLocalId, paragraph.getText());
        }
      }
      await context.sync();

      const currentTextById = new Map<string, string | null>();
      for (const id of targetIds) {
        // An id with no live paragraph resolves to null, which no send-time
        // text can equal — the user deleted it, so the edit is "changed".
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

      // Scoped so the catch below can hand the snapshot back: a rejected write
      // sync is precisely when Revert matters, because the host may have
      // applied part of the batch before the command that failed.
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

      // Bounded v1 result navigation: only a single surviving paragraph with
      // exact replacement text. Range/newline results stay explicitly unavailable.
      // A read failure here never changes a confirmed write into a failed write.
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
        /* The review remains available even when location is not. */
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

/**
 * The ONLY mutating call in the edit path (D-31's single point of change).
 *
 * The span's trailing paragraphs are removed first and the head paragraph is
 * replaced last, so the head — the one whose style the result inherits — is
 * touched once and the removals cannot disturb it.
 */
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
    // String literal rather than `Word.InsertLocation.replace`: the enum is a
    // RUNTIME member of the Office.js `Word` namespace, so reaching for it
    // would couple the executor to the full office.js bundle being loaded.
    // The typings accept the literal and it is what crosses the wire anyway.
    .insertText(text, "Replace");
}

/**
 * Restore the body from the one pre-batch snapshot.
 *
 * Whole-body replace: the snapshot is the whole body, and a partial restore
 * would have to re-locate paragraphs that the batch itself moved. The caller
 * owns the single-use rule and the identity gate.
 */
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
