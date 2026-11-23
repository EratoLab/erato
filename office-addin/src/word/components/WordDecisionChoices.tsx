import {
  ActionConfirmationCard,
  alwaysAllowLockedLine,
} from "@erato/frontend/library";
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

/**
 * The decision place's usual choices, under the Word card's own label for Apply. Without
 * `canApply` only Cancel and Never stay, so a change the card cannot make can still be declined.
 */
export function WordDecisionChoices({
  decision,
  title,
  applyLabel,
  canApply,
  standingLabel,
  alwaysLockedReason,
  confirmation,
}: {
  decision: WordCardDecision;
  title: string;
  applyLabel: string;
  canApply: boolean;
  /** Names everything Always and Never cover, which can be more than this card's change. */
  standingLabel: string;
  /** The card's own reason to ask every time. */
  alwaysLockedReason?: string;
  /** The card's ticks and rows, sent with an approval. */
  confirmation?: Record<string, unknown>;
}) {
  const offersAlways = canApply && !decision.decideOnScreen;
  const lockedReason = !offersAlways
    ? undefined
    : (alwaysLockedReason ??
      (decision.allowAlways ? undefined : alwaysAllowLockedLine()));
  const extras = confirmation ? { clientConfirmation: confirmation } : {};
  return (
    <ActionConfirmationCard
      title={title}
      allowOnceLabel={applyLabel}
      onAllowOnce={
        canApply ? () => decision.onDecide("approve", extras) : undefined
      }
      standingLabel={standingLabel}
      standingNote={lockedReason}
      onAlwaysAllow={
        offersAlways
          ? () => decision.onDecide("approve_always", extras)
          : undefined
      }
      alwaysAllowDisabledReason={lockedReason}
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

export function wordPlanStandingLabel(): string {
  return t({
    id: "officeAddin.word.decision.standing.plan",
    message: "Every change to the document:",
  });
}

export function wordCommentsStandingLabel(): string {
  return t({
    id: "officeAddin.word.decision.standing.comments",
    message: "Every comment change, new comments included:",
  });
}
