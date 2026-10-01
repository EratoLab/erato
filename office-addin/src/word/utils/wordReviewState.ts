import type {
  WordDocumentApplyStatus,
  WordDocumentDiagnostic,
} from "./wordApplyDocumentPlan";
import type { WordApplyStage } from "./wordApplyProgress";
import type { WordReviewAnchor, WordTrackingMode } from "./wordReviewLocation";
import type { WordWriteBlockReason } from "./wordWriteGate";
import type {
  WordDocumentCapture,
  WordEditOutcome,
} from "@erato/frontend/word-review";

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
  /** Kept in the provider so the busy label survives card remounts. */
  applyStage?: WordApplyStage;
}
export const EMPTY_WORD_REVIEW: WordReviewState = {
  status: "idle",
  outcomes: [],
};
