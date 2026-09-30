import { t } from "@lingui/core/macro";

import { wordEditsAppliedText, wordEditTotalsText } from "./WordEditReport";
import { wordEditCounts } from "../utils/wordEditPlan";

import type { WordReviewState } from "../utils/wordReviewState";

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
  const counts = wordEditCounts(review.outcomes);
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
          ? t({
              id: "officeAddin.word.review.denied",
              message: "Proposal declined. Nothing was written.",
            })
          : review.status === "reverted"
            ? wholeDocument
              ? t({
                  id: "officeAddin.word.planReceipt.restoredDocument",
                  message: "Restored the document",
                })
              : t({
                  id: "officeAddin.word.planReceipt.undone",
                  message: `Undone: ${title}`,
                })
            : kind === "plan"
              ? t({
                  id: "officeAddin.word.planReceipt.applied",
                  message: `Applied: ${title}`,
                })
              : kind === "insert"
                ? t({
                    id: "officeAddin.word.card.inserted",
                    message: "Inserted into the document.",
                  })
                : wordEditsAppliedText(counts.applied)}
      </strong>
      {kind === "edits" && review.status === "done" && (
        <span className="word-review__hint">{wordEditTotalsText(counts)}</span>
      )}
      {review.automatic && review.status === "done" && (
        <span className="word-review__hint">
          {t({
            id: "officeAddin.word.review.automatic",
            message: "Automatic action under your Always allow setting.",
          })}
        </span>
      )}
    </div>
  );
}
