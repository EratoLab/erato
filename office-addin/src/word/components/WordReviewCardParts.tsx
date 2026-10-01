import {
  ActionConfirmationCard,
  Alert,
  Button,
  CopyErrorButton,
  WordDisclosure,
} from "@erato/frontend/library";
import { t } from "@lingui/core/macro";

import { decisionKey } from "../utils/clientActionPolicy";
import { wordApplyStageLabel } from "../utils/wordAuthoringMessages";

import type { ConfirmCardState } from "../../core/clientActions/useClientActionConfirmFlow";
import type { ClientActionDecisionMap } from "../utils/clientActionPolicy";
import type { WordDocumentDiagnostic } from "../utils/wordApplyDocumentPlan";
import type { WordApplyStage } from "../utils/wordApplyProgress";
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

export function isAutomaticWordRun({
  presentation,
  decisions,
  facetId,
  action,
  enforcedAskActions,
}: {
  presentation: string | undefined;
  decisions: ClientActionDecisionMap;
  facetId: string;
  action: string;
  enforcedAskActions: readonly string[];
}): boolean {
  return (
    presentation === "auto_prompt" &&
    decisions[decisionKey(facetId, action)] === "always" &&
    !enforcedAskActions.includes(action)
  );
}

/**
 * `canApply` is the card's own readiness (gate, review state, payload); the
 * operation lock and the organisation's always-ask list are checked here.
 */
export function WordReviewConfirm<TSummary, TAction extends string>({
  card,
  title,
  description,
  allowOnceLabel,
  canApply,
  operationInProgress,
  enforcedAskActions,
  decisions,
  setDecisions,
  facetId,
  allowCard,
  denyCard,
  onDenied,
  applying,
  applyStage,
}: {
  card: ConfirmCardState<TSummary, TAction>;
  title: string;
  description?: ReactNode;
  allowOnceLabel: string;
  canApply: boolean;
  operationInProgress: boolean;
  enforcedAskActions: readonly string[];
  decisions: ClientActionDecisionMap;
  setDecisions: (value: ClientActionDecisionMap | null) => void;
  facetId: string;
  allowCard: (card: ConfirmCardState<TSummary, TAction>) => void;
  denyCard: (card: ConfirmCardState<TSummary, TAction>) => void;
  onDenied: () => void;
  applying: boolean;
  applyStage: WordApplyStage | undefined;
}) {
  const locked = enforcedAskActions.includes(card.action);
  return (
    <ActionConfirmationCard
      title={title}
      description={description}
      allowOnceLabel={allowOnceLabel}
      denyLabel={t({ id: "officeAddin.word.review.cancel", message: "Cancel" })}
      onAllowOnce={() => {
        if (canApply && !operationInProgress) allowCard(card);
      }}
      onAlwaysAllow={() => {
        if (!canApply || operationInProgress || locked) return;
        setDecisions({
          ...decisions,
          [decisionKey(facetId, card.action)]: "always",
        });
        allowCard(card);
      }}
      alwaysAllowDisabledReason={
        locked
          ? t({
              id: "officeAddin.word.card.alwaysAllowLocked",
              message:
                "Your organization requires confirmation each time this action runs automatically.",
            })
          : undefined
      }
      onDeny={() => {
        denyCard(card);
        onDenied();
      }}
      isBusy={operationInProgress || !canApply}
      progressLabel={applying ? wordApplyStageLabel(applyStage) : undefined}
      scrollIntoViewOnMount={card.autoTriggered}
    />
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
      className="m-3 [overflow-wrap:anywhere]"
    >
      {children}
    </Alert>
  );
}
