import { wordCommentShownParagraph } from "./wordCommentReader";
import { wordHostPlatform, wordReadsCommentRanges } from "./wordHostPlatform";
import { resolveWordParagraphs } from "./wordParagraphResolver";
import { selectsAcrossParagraphs, selectWordRange } from "./wordReviewLocation";
import { runWordGuarded } from "./wordRunGuard";
import { buildWordSelectionRanges } from "./wordSelectionRange";
import { currentWordSelectionSupport } from "./wordSelectionSupport";
import {
  readWordStory,
  WORD_SELECTION_SHOW_TIMEOUT_MS,
} from "./wordSelectionTarget";

import type { WordCommentAddTarget } from "./wordCommentChanges";
import type { WordSelectionShowResult } from "./wordSelectionTarget";

/**
 * Selects a comment's anchor in Word, found by String(Comment.id) (F-2). Word for the web rewrites
 * the end paragraphs of a range it selects across paragraphs (ERMAIN-932), so there the first
 * paragraph of a longer anchor stands in. selectWordRange marks the select, so the live selection
 * reader takes the passage for Erato's and a picked thread outlives it. An id Word lists twice
 * (F-19) or no longer lists is "changed": either way no single anchor can be shown. Where no
 * comment range may be read (wordReadsCommentRanges), the paragraph the anchor starts in is
 * selected whole: `para`, the paragraph the read placed it in, when it still holds the comment.
 */
export async function showWordComment(
  commentId: string,
  para: number | null = null,
): Promise<WordSelectionShowResult> {
  const result = await runWordGuarded(
    async (context, guard) => {
      const comments = context.document.body.getComments();
      comments.load("items/id,items/content,items/authorName");
      await context.sync();
      const matches = comments.items.filter(
        (comment) => String(comment.id) === commentId,
      );
      if (matches.length !== 1) return "changed" as const;
      let target: Word.Range;
      if (!wordReadsCommentRanges(wordHostPlatform())) {
        const paragraph = await wordCommentShownParagraph(
          context,
          {
            id: commentId,
            content: matches[0].content,
            authorName: matches[0].authorName,
          },
          para,
        );
        if (!paragraph) return "changed" as const;
        target = paragraph.getRange("Content");
      } else {
        const range = matches[0].getRange();
        target = range;
        if (!selectsAcrossParagraphs()) {
          const first = range.paragraphs.getFirst();
          const relation = first
            .getRange("Whole")
            .compareLocationWith(range.paragraphs.getLast().getRange("Whole"));
          await context.sync();
          if (relation.value !== "Equal") target = first.getRange("Content");
        }
      }
      guard.beforeSelect();
      await selectWordRange(context, target);
      return "selected" as const;
    },
    { timeoutMs: WORD_SELECTION_SHOW_TIMEOUT_MS },
  );
  return result.outcome === "ok" && result.value ? result.value : "unavailable";
}

/**
 * Selects where a new comment would go: the passage found by Word's search, or the first
 * paragraph of a passage across paragraphs, as Word for the web rewrites the end paragraphs of a
 * range it selects across paragraphs (ERMAIN-932).
 */
export async function showWordCommentTarget(
  add: WordCommentAddTarget,
): Promise<WordSelectionShowResult> {
  const result = await runWordGuarded(
    async (context, guard) => {
      const story = await readWordStory(context);
      const resolved = resolveWordParagraphs(add.anchor, story.entries);
      if ("refused" in resolved) return "changed" as const;
      const first = story.items[resolved.positions[0]];
      let target = first.getRange("Content");
      if (
        resolved.positions.length === 1 &&
        story.rangeTexts[resolved.positions[0]] === add.rangeTexts[0]
      ) {
        const built = await buildWordSelectionRanges(
          context,
          [
            {
              paragraph: first,
              rangeText: add.rangeTexts[0],
              start: add.start,
              end: add.end,
            },
          ],
          currentWordSelectionSupport(),
        );
        const part = "parts" in built ? built.parts[0] : undefined;
        if (part?.kind === "part") target = part.range;
      }
      guard.beforeSelect();
      await selectWordRange(context, target);
      return "selected" as const;
    },
    { timeoutMs: WORD_SELECTION_SHOW_TIMEOUT_MS },
  );
  return result.outcome === "ok" && result.value ? result.value : "unavailable";
}
