import { wordCommentRangeReadable } from "./wordCommentReader";
import { selectsAcrossParagraphs, selectWordRange } from "./wordReviewLocation";
import { runWordGuarded } from "./wordRunGuard";
import { WORD_SELECTION_SHOW_TIMEOUT_MS } from "./wordSelectionTarget";

import type { WordSelectionShowResult } from "./wordSelectionTarget";

/**
 * Selects a comment's anchor in Word, found by String(Comment.id) (F-2). Word for the web rewrites
 * the end paragraphs of a range it selects across paragraphs (ERMAIN-932), so there the first
 * paragraph of a longer anchor stands in. selectWordRange marks the select, so the live selection
 * reader takes the passage for Erato's and a picked thread outlives it. An id Word lists twice
 * (F-19) or no longer lists is "changed": either way no single anchor can be shown. Off desktop, an
 * anchor whose range would unhide text before it (gate F1) is not shown.
 */
export async function showWordComment(
  commentId: string,
): Promise<WordSelectionShowResult> {
  const result = await runWordGuarded(
    async (context, guard) => {
      const comments = context.document.body.getComments();
      comments.load("items/id");
      await context.sync();
      const matches = comments.items.filter(
        (comment) => String(comment.id) === commentId,
      );
      if (matches.length !== 1) return "changed" as const;
      if (!(await wordCommentRangeReadable(context, comments.items, commentId)))
        return "unavailable" as const;
      const range = matches[0].getRange();
      let target = range;
      if (!selectsAcrossParagraphs()) {
        const first = range.paragraphs.getFirst();
        const relation = first
          .getRange("Whole")
          .compareLocationWith(range.paragraphs.getLast().getRange("Whole"));
        await context.sync();
        if (relation.value !== "Equal") target = first.getRange("Content");
      }
      guard.beforeSelect();
      await selectWordRange(context, target);
      return "selected" as const;
    },
    { timeoutMs: WORD_SELECTION_SHOW_TIMEOUT_MS },
  );
  return result.outcome === "ok" && result.value ? result.value : "unavailable";
}
