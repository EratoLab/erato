import { t } from "@lingui/core/macro";

import type { WordReviewState } from "../utils/wordReviewState";

/** A retained outcome, with the full comparison available through Show details. */
export function WordReviewReceipt({
  review,
  kind,
}: {
  review: WordReviewState;
  kind: "edits" | "insert" | "plan";
}) {
  const applied = review.outcomes.filter(
    (item) => item.status === "applied",
  ).length;
  const failed = review.outcomes.filter(
    (item) => item.status === "failed",
  ).length;
  const skipped = review.outcomes.length - applied - failed;
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
            ? t({
                id: "officeAddin.word.review.restored",
                message: "Document body restored",
              })
            : kind === "plan"
              ? t({
                  id: "officeAddin.word.authoring.applied",
                  message: "Document rewrite applied",
                })
              : kind === "insert"
                ? t({
                    id: "officeAddin.word.card.inserted",
                    message: "Inserted into the document.",
                  })
                : applied === 1
                  ? t({
                      id: "officeAddin.word.review.oneApplied",
                      message: "1 edit applied",
                    })
                  : t({
                      id: "officeAddin.word.review.appliedCount",
                      message: `${applied} edits applied`,
                    })}
      </strong>
      {kind === "plan" && (
        <span className="word-review__hint">
          {t({
            id: "officeAddin.word.authoring.receiptScope",
            message: "The complete plan remains available in details.",
          })}
        </span>
      )}
      {kind === "edits" && review.status === "done" && (
        <span className="word-review__totals">
          {t({
            id: "officeAddin.word.review.totals",
            message: `${applied} applied · ${skipped} skipped · ${failed} failed`,
          })}
        </span>
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
