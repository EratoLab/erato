import { ActionConfirmationCard } from "@erato/frontend/library";
import { t } from "@lingui/core/macro";

import type { ApprovalItemCardProps } from "@erato/frontend/library";

/** What a Word card drawn in the decision place needs to decide its item. */
export interface WordCardDecision {
  allowAlways: boolean;
  /** The change needs a choice on screen, so Always is never offered on it. */
  decideOnScreen: boolean;
  status: ApprovalItemCardProps["status"];
  resolvedLabel: string | undefined;
  isBusy: boolean;
  onDecide: ApprovalItemCardProps["onDecide"];
}

/** The decision place's usual choices, under the Word card's own label for Apply. */
export function WordDecisionChoices({
  decision,
  title,
  applyLabel,
  canApply,
  confirmation,
}: {
  decision: WordCardDecision;
  title: string;
  applyLabel: string;
  canApply: boolean;
  /** The card's ticks and rows, sent with an approval. */
  confirmation?: Record<string, unknown>;
}) {
  const offersAlways = decision.allowAlways && !decision.decideOnScreen;
  const extras = confirmation ? { clientConfirmation: confirmation } : {};
  return (
    <ActionConfirmationCard
      title={title}
      allowOnceLabel={applyLabel}
      onAllowOnce={
        canApply ? () => decision.onDecide("approve", extras) : undefined
      }
      onAlwaysAllow={
        offersAlways && canApply
          ? () => decision.onDecide("approve_always", extras)
          : undefined
      }
      denyLabel={t({ id: "officeAddin.word.review.cancel", message: "Cancel" })}
      onDeny={() => decision.onDecide("reject")}
      onNeverAllow={() => decision.onDecide("reject_always")}
      status={decision.status}
      resolvedLabel={decision.resolvedLabel}
      isBusy={decision.isBusy}
      data-testid="word-decision-choices"
    />
  );
}
