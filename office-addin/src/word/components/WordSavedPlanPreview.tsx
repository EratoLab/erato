import { t } from "@lingui/core/macro";
import { useMemo } from "react";

import { WordDocumentPlanReview } from "./WordDocumentPlanReview";
import { buildWordPlanReview } from "../utils/wordPlanReview";

import type { WordDocumentPlan } from "../utils/wordDocumentPlan";

/** Saved previews have no live object inventory and cannot authorize writes. */
export function WordSavedPlanPreview({ plan }: { plan: WordDocumentPlan }) {
  const review = useMemo(() => buildWordPlanReview(plan, undefined), [plan]);
  return (
    <WordDocumentPlanReview
      plan={plan}
      review={review}
      note={
        <p className="word-review__hint">
          {t({
            id: "officeAddin.word.authoring.savedDraftSources",
            message:
              "The submitted draft is saved. Original source content and image data are unavailable in this session; applying requires a fresh document request.",
          })}
        </p>
      }
    />
  );
}
