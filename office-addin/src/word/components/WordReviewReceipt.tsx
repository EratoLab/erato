import { wordEditCounts } from "@erato/frontend/word-review";
import { t } from "@lingui/core/macro";

import { wordEditsAppliedText, wordEditExceptionsText } from "./WordEditReport";
import {
  wordPlanAdjustedHeadline,
  wordPlanVerifiedText,
} from "../utils/wordAuthoringMessages";
import { wordPlanOutcomeState } from "../utils/wordReviewState";

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
export const wordReplacedText = () =>
  t({
    id: "officeAddin.word.selection.replaced",
    message: "Replaced the selected passage.",
  });
export const wordReplaceUnchangedText = () =>
  t({
    id: "officeAddin.word.selection.unchanged",
    message: "The proposal matches the passage. Nothing was replaced.",
  });
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
  note = "",
}: {
  review: WordReviewState;
  kind: "edits" | "insert" | "plan" | "selection";
  /** The card's own title, so the receipt names what was changed or undone. */
  title?: string;
  wholeDocument?: boolean;
  /** What Word did on its own while writing, which the folded card still says. */
  note?: string;
}) {
  const exceptions =
    kind === "edits" && review.status === "done"
      ? wordEditExceptionsText(wordEditCounts(review.outcomes))
      : "";
  const outcome = kind === "plan" ? wordPlanOutcomeState(review) : undefined;
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
            : outcome === "adjusted"
              ? wordPlanAdjustedHeadline()
              : kind === "plan"
                ? t({
                    id: "officeAddin.word.planReceipt.applied",
                    message: `Applied: ${title}`,
                  })
                : kind === "insert"
                  ? wordInsertedText()
                  : kind === "selection"
                    ? review.selection?.status === "unchanged"
                      ? wordReplaceUnchangedText()
                      : wordReplacedText()
                    : wordEditsAppliedText(
                        wordEditCounts(review.outcomes).applied,
                      )}
      </strong>
      {outcome === "verified" && (
        <span className="word-review__hint">{wordPlanVerifiedText()}</span>
      )}
      {exceptions && <span className="word-review__hint">{exceptions}</span>}
      {note && (
        <span className="word-review__hint" data-testid="word-plan-adjustments">
          {note}
        </span>
      )}
      {review.automatic && review.status === "done" && (
        <span className="word-review__hint">{wordAutomaticText()}</span>
      )}
    </div>
  );
}
