import { wordEditCounts } from "@erato/frontend/word-review";
import { t } from "@lingui/core/macro";

import { wordEditsAppliedText, wordEditExceptionsText } from "./WordEditReport";

import type { WordReviewState } from "../utils/wordReviewState";

export const wordDeniedText = () =>
  t({
    id: "officeAddin.word.review.denied",
    message: "Proposal declined. Nothing was written.",
  });
export const wordInsertedText = () =>
  t({
    id: "officeAddin.word.card.inserted",
    message: "Inserted into the document.",
  });
export const wordUndoneText = (title: string) =>
  t({ id: "officeAddin.word.planReceipt.undone", message: `Undone: ${title}` });
export const wordAutomaticText = () =>
  t({
    id: "officeAddin.word.review.automatic",
    message: "Automatic action under your Always allow setting.",
  });

export function WordReviewReceipt({
  review,
  kind,
  title = "",
  wholeDocument = false,
}: {
  review: WordReviewState;
  kind: "edits" | "insert" | "plan";
  /** The card's own title, so the receipt names what was changed or undone. */
  title?: string;
  wholeDocument?: boolean;
}) {
  const exceptions =
    kind === "edits" && review.status === "done"
      ? wordEditExceptionsText(wordEditCounts(review.outcomes))
      : "";
  return (
    <div
      className="word-review__receipt focus-ring"
      role="status"
      tabIndex={-1}
      data-word-review-result
      data-testid="word-review-receipt"
    >
      <strong>
        {review.status === "denied"
          ? wordDeniedText()
          : review.status === "reverted"
            ? wholeDocument
              ? t({
                  id: "officeAddin.word.planReceipt.restoredDocument",
                  message: "Restored the document",
                })
              : wordUndoneText(title)
            : kind === "plan"
              ? t({
                  id: "officeAddin.word.planReceipt.applied",
                  message: `Applied: ${title}`,
                })
              : kind === "insert"
                ? wordInsertedText()
                : wordEditsAppliedText(wordEditCounts(review.outcomes).applied)}
      </strong>
      {exceptions && <span className="word-review__hint">{exceptions}</span>}
      {review.automatic && review.status === "done" && (
        <span className="word-review__hint">{wordAutomaticText()}</span>
      )}
    </div>
  );
}
