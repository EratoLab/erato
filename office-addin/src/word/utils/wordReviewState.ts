import type {
  WordApplyOutcome,
  WordDocumentApplyStatus,
  WordDocumentDiagnostic,
} from "./wordApplyDocumentPlan";
import type { WordApplyStage } from "./wordApplyProgress";
import type {
  WordCommentRevertResult,
  WordCommentRowResult,
} from "./wordCommentWrites";
import type {
  WordPlanRoute,
  WordWholeDocumentRefusal,
  WordWholeDocumentWrite,
} from "./wordInPlaceRoute";
import type { WordReplaceSelectionResult } from "./wordReplaceSelection";
import type { WordReviewAnchor, WordTrackingMode } from "./wordReviewLocation";
import type { WordWriteBlockReason } from "./wordWriteGate";
import type {
  WordCommentConsentKind,
  WordCommentConsentState,
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
  /** Outcome of the last verified Apply or Revert of this plan. */
  documentPlanOutcome?: WordApplyOutcome;
  /** Kept in the provider so the busy label survives card remounts. */
  applyStage?: WordApplyStage;
  /** Paragraph edits: why the last Revert was refused. `tracking` stays the mode at Apply, which
   * decides whether Word holds revisions of this batch to reject. */
  revertStale?: "tracking" | "changed";
  /** A selection Undo that wrote nothing; its backup stays so Undo can be tried again. */
  revertFailed?: "failed" | "timed-out";
  /** A selection Replace: its result, which decides the card's message, locator and Undo. */
  selection?: WordReplaceSelectionResult;
  /** A selection Replace refused because another version from the same answer holds the passage.
   * The card stays idle, so it can be replaced once that version is undone. */
  refusedForSibling?: boolean;
  /** A document plan's Apply that stopped before writing because the host's policy asks before, or
   * refuses, replacing the whole document. The card stays idle and offers that choice, not an error. */
  wholeDocumentBlock?: WordWholeDocumentBlock;
  /** Comment changes: the rows the user ticked, each row's latest outcome, and Revert. */
  comments?: WordCommentCardState;
}

export interface WordCommentCardState {
  /** Row indexes ticked on the card; all of them until the user unticks one. */
  selected: readonly number[];
  /** The latest outcome per row, across Apply, Retry and "Post under my name instead". */
  rows: readonly WordCommentRowResult[];
  consent?: WordCommentConsentState;
  consentKind?: WordCommentConsentKind | null;
  /** Revert is single use. */
  revert?: readonly WordCommentRevertResult[];
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

export type WordWholeDocumentBlock = WordDocumentDiagnostic & {
  reason: "import-needs-confirmation" | WordWholeDocumentRefusal;
};

const WHOLE_DOCUMENT_BLOCKS = new Set<WordDocumentDiagnostic["reason"]>([
  "import-needs-confirmation",
  "import-disabled",
  "scoped-needs-in-place",
]);

/** Apply's own policy check, which the card offers as its confirm or refusal choice. */
export function isWordWholeDocumentBlock(
  diagnostic: WordDocumentDiagnostic | undefined,
): diagnostic is WordWholeDocumentBlock {
  return (
    diagnostic?.stage === "validate" &&
    WHOLE_DOCUMENT_BLOCKS.has(diagnostic.reason)
  );
}

export function wordWholeDocumentBlockWrite(
  block: WordWholeDocumentBlock,
): WordWholeDocumentWrite {
  return block.reason === "import-needs-confirmation"
    ? { write: "confirm" }
    : { write: "refuse", reason: block.reason };
}

/** The route Apply found live, for the card's reason line. */
export function wordWholeDocumentBlockRoute(
  block: WordWholeDocumentBlock,
): WordPlanRoute {
  return block.details?.route === "body"
    ? { route: "body" }
    : {
        route: "import",
        reason: block.details?.routeReason ?? "program-mismatch",
      };
}
