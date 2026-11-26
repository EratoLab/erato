import {
  Alert,
  Button,
  CopyErrorButton,
  WordDisclosure,
} from "@erato/frontend/library";
import { t } from "@lingui/core/macro";

import { wordApplyStageLabel } from "../utils/wordAuthoringMessages";
import { wordChainedApplyText } from "../utils/wordChainedApply";

import type { WordDocumentDiagnostic } from "../utils/wordApplyDocumentPlan";
import type { WordApplyStage } from "../utils/wordApplyProgress";
import type { WordChainedApplyState } from "../utils/wordChainedApply";
import type { WordReviewStatus } from "../utils/wordReviewState";
import type { WordWriteBlockReason } from "../utils/wordWriteGate";
import type { ReactNode } from "react";

// Busy rather than disabled keeps focus on the button while Word works.
export function WordApplyButton({
  applying,
  applyStage,
  disabled,
  label,
  onApply,
}: {
  applying: boolean;
  applyStage: WordApplyStage | undefined;
  disabled: boolean;
  label: string;
  onApply: () => void;
}) {
  return (
    <Button
      type="button"
      variant="primary"
      busy={applying}
      aria-disabled={applying || undefined}
      disabled={!applying && disabled}
      onClick={applying ? undefined : onApply}
    >
      {applying ? wordApplyStageLabel(applyStage) : label}
    </Button>
  );
}

/**
 * Where the server's call for the card's change stands, where the card's own review does not say
 * it. While that call writes, the stage it is at.
 */
export function WordChainedStatus({
  state,
  applying,
  applyStage,
}: {
  state: WordChainedApplyState;
  applying: boolean;
  applyStage: WordApplyStage | undefined;
}) {
  return (
    <p
      className="word-review__hint"
      role="status"
      data-testid="word-chained-status"
    >
      {applying ? wordApplyStageLabel(applyStage) : wordChainedApplyText(state)}
    </p>
  );
}

export function WordDiagnosticDetails({
  diagnostic,
}: {
  diagnostic: WordDocumentDiagnostic | undefined;
}) {
  const text = [diagnostic?.officeCode, diagnostic?.officeLocation]
    .filter(Boolean)
    .join(" · ");
  if (!text) return null;
  return (
    <WordDisclosure
      label={t({
        id: "officeAddin.word.review.supportDetails",
        message: "Details for support",
      })}
      className="word-review__diagnostic"
      bodyClassName="word-review__diagnostic-body"
    >
      <p className="word-review__hint">
        {t({
          id: "officeAddin.word.authoring.wordDiagnostic",
          message: "Word diagnostic",
        })}
        {": "}
        <code>{text}</code>
      </p>
      <CopyErrorButton report={`Word diagnostic: ${text}`} />
    </WordDisclosure>
  );
}

export function wordBlockedReasonText(reason: WordWriteBlockReason): string {
  return reason === "no-capture"
    ? t({
        id: "officeAddin.word.card.blocked.noCapture",
        message:
          "This pane no longer has the document snapshot this answer was written against. Include the document and ask again to apply changes.",
      })
    : t({
        id: "officeAddin.word.card.blocked.identity",
        message:
          "This answer was written about a different document than the one open now, so it cannot be applied here.",
      });
}

const FAILED_STATUSES: readonly WordReviewStatus[] = [
  "error",
  "write-failed",
  "revert-failed",
];

export function wordStatusAlertProps(status: WordReviewStatus): {
  type: "error" | "info";
  role: "alert" | "status";
} {
  return FAILED_STATUSES.includes(status)
    ? { type: "error", role: "alert" }
    : { type: "info", role: "status" };
}

export function WordStatusAlert({
  status,
  children,
}: {
  status: WordReviewStatus;
  children: ReactNode;
}) {
  return (
    <Alert
      {...wordStatusAlertProps(status)}
      className="word-review__aside my-3 [overflow-wrap:anywhere]"
    >
      {children}
    </Alert>
  );
}

/** L2: shown where a request carried comments by other people, which suspends Always. */
export function wordCommentTaintText(): string {
  return t({
    id: "officeAddin.word.comments.always.tainted",
    message:
      "This request included comments by other people, so Erato asks each time.",
  });
}
