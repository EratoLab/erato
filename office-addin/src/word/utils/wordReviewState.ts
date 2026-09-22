import type {
  WordDocumentApplyStatus,
  WordDocumentDiagnostic,
} from "./wordApplyDocumentPlan";
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
  /** Completed batches default to a receipt; keep the user's disclosure choice. */
  detailsExpanded?: boolean;
  documentPlanStatus?: WordDocumentApplyStatus | "revert-stale";
  documentPlanDiagnostic?: WordDocumentDiagnostic;
}
export const EMPTY_WORD_REVIEW: WordReviewState = {
  status: "idle",
  outcomes: [],
};
