import { useMemo } from "react";

import { WordDocumentPlanReview } from "./WordDocumentPlanReview";
import { buildWordPlanReview } from "../utils/wordPlanReview";

import type { WordDocumentPlan } from "../utils/wordDocumentPlan";

/** Saved previews have no live object inventory and cannot authorize writes. */
export function WordSavedPlanPreview({ plan }: { plan: WordDocumentPlan }) {
  const review = useMemo(() => buildWordPlanReview(plan, undefined), [plan]);
  return <WordDocumentPlanReview plan={plan} review={review} />;
}
