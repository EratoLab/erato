import type {
  WordApplyOutcome,
  WordDocumentApplyStatus,
  WordDocumentDiagnostic,
} from "./wordApplyDocumentPlan";
import type { WordApplyStage } from "./wordApplyProgress";
import type { WordDocumentCapture } from "./wordDocumentCapture";
import type { WordEditOutcome } from "./wordEditPlan";
import type { WordReviewAnchor, WordTrackingMode } from "./wordReviewLocation";
import type { WordWriteBlockReason } from "./wordWriteGate";

export type WordReviewStatus =
  | "idle"
  | "applying"
  | "done"
  | "error"
  | "write-failed"
  | "denied"
  | "reverting"
  | "reverted"
  | "revert-failed"
  | WordWriteBlockReason;
export interface WordReviewState {
  status: WordReviewStatus;
  outcomes: readonly WordEditOutcome[];
  capture?: WordDocumentCapture;
  anchors?: ReadonlyMap<number, WordReviewAnchor>;
  locationGeneration?: number;
  tracking?: WordTrackingMode;
  automatic?: boolean;
  detailsExpanded?: boolean;
  documentPlanStatus?: WordDocumentApplyStatus | "revert-stale";
  documentPlanDiagnostic?: WordDocumentDiagnostic;
  /** Outcome of the last verified Apply or Revert of this plan. */
  documentPlanOutcome?: WordApplyOutcome;
  /** Kept in the provider so the busy label survives card remounts. */
  applyStage?: WordApplyStage;
  /** Paragraph edits: why the last Revert was refused. `tracking` stays the mode at Apply, which
   * decides whether Word holds revisions of this batch to reject. */
  revertStale?: "tracking" | "changed";
}
export const EMPTY_WORD_REVIEW: WordReviewState = {
  status: "idle",
  outcomes: [],
};

/** What an Apply of a document plan amounts to for the reader. */
export type WordPlanOutcomeState =
  | "verified"
  | "adjusted"
  | "unverified"
  | "partly-written"
  | "not-written";

export function wordPlanOutcomeState(
  review: WordReviewState,
): WordPlanOutcomeState | undefined {
  switch (review.status) {
    case "done":
      return review.documentPlanOutcome?.tier === "content"
        ? "adjusted"
        : "verified";
    case "write-failed":
      return review.documentPlanDiagnostic?.stage === "verify"
        ? "unverified"
        : "partly-written";
    case "error":
      return "not-written";
    default:
      return undefined;
  }
}

/** Distinct body blocks or story paragraphs a failed verification names. */
export function wordMismatchedPassages(
  diagnostic: WordDocumentDiagnostic | undefined,
): number {
  return new Set(
    (diagnostic?.details?.locations ?? []).flatMap((location) => {
      const match =
        /^(\/\S+ (?:body block|paragraph) \d+|\/word story paragraph \d+): /.exec(
          location,
        );
      return match ? [match[1]] : [];
    }),
  ).size;
}
