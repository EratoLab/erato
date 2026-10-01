import { t } from "@lingui/core/macro";
import { useId, useMemo, useState } from "react";

import { Button } from "@/components/ui/Controls/Button";
import {
  buildWordPlanReview,
  wordPlanText,
} from "@/lib/wordReview/wordPlanReview";

import { WordDocumentPlanReview } from "./WordDocumentPlanReview";
import { WordReviewCard, WordReviewDetailsToggle } from "./WordReviewCardParts";

import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
} from "@/lib/wordReview/wordDocumentPlan";
import type { WordPlanReview } from "@/lib/wordReview/wordPlanReview";
import type { ComponentProps, ReactNode } from "react";

/** Live state a host shows in place of the read-only provenance footer. */
export interface WordProposalStatus {
  /** A completed card folds to its receipt until the details are reopened. */
  collapsed: boolean;
  /** Offers Show/Hide details when set. */
  onToggleDetails?: () => void;
  receipt?: ReactNode;
  alert?: ReactNode;
  /** Rendered after the alert while the card is expanded. */
  trailing?: ReactNode;
  /** Rendered under the review, such as why the plan cannot be applied here. */
  notice?: ReactNode;
  /** Short feedback after a footer action. */
  note?: string;
}

/**
 * What a host that can write to the document plugs into the card. Without
 * one the card is read-only: it reviews the plan and offers its text.
 */
export interface WordProposalAdapter {
  /** Selects a source block in the open document; rows offer it only when set. */
  locate?: (ref: string) => void;
  /** The apply control, or the consent card that replaces it. */
  apply?: ReactNode;
  /** Host actions beside the details toggle. */
  actions?: ReactNode;
  /** The undo line under the actions. */
  revert?: ReactNode;
  status?: WordProposalStatus;
}

export interface WordProposalCardProps {
  plan: WordDocumentPlan;
  /** The document the plan was written against; enables the full review with Check first. */
  snapshot?: WordAuthoringSnapshot;
  /** Precomputed review of `plan` against `snapshot`. */
  review?: WordPlanReview;
  documentName?: string;
  /** Accessible name of the card region. */
  label?: string;
  testId?: string;
  cardRef?: ComponentProps<typeof WordReviewCard>["cardRef"];
  /** Whether a plan without a snapshot is drawn from its own data. */
  showSavedPlan?: boolean;
  adapter?: WordProposalAdapter;
}

export function WordProposalCard({
  plan,
  snapshot,
  review,
  documentName,
  label,
  testId = "word-proposal-card",
  cardRef,
  showSavedPlan = true,
  adapter,
}: WordProposalCardProps) {
  const detailsId = useId();
  const derived = useMemo(
    () => review ?? buildWordPlanReview(plan, snapshot),
    [review, plan, snapshot],
  );
  const status = adapter?.status;
  const collapsed = !!status?.collapsed;
  return (
    <WordReviewCard
      cardRef={cardRef}
      label={
        label ??
        t({
          id: "officeAddin.word.proposal.label",
          message: "Proposed document changes",
        })
      }
      testId={testId}
      collapsed={collapsed}
      detailsId={detailsId}
      receipt={status?.receipt}
      status={status?.alert}
      trailing={status?.trailing}
      footer={
        adapter ? (
          <>
            {adapter.apply}
            <div className="word-review__actions">
              {status?.onToggleDetails && (
                <WordReviewDetailsToggle
                  collapsed={collapsed}
                  controls={detailsId}
                  onToggle={status.onToggleDetails}
                />
              )}
              {adapter.actions}
            </div>
            {adapter.revert}
            {status?.note && (
              <p role="status" className="word-review__hint">
                {status.note}
              </p>
            )}
          </>
        ) : (
          <WordProposalReadOnlyFooter
            text={() => wordPlanText(plan, snapshot)}
            documentName={documentName}
          />
        )
      }
    >
      {(snapshot !== undefined || showSavedPlan) && (
        <WordDocumentPlanReview
          plan={plan}
          snapshot={snapshot}
          review={derived}
          onLocate={snapshot ? adapter?.locate : undefined}
        />
      )}
      {status?.notice}
    </WordReviewCard>
  );
}

/** "From Word" provenance with the way to apply, for a card that cannot write. */
export function WordProposalReadOnlyFooter({
  text,
  documentName,
}: {
  text: () => string;
  documentName?: string;
}) {
  const [note, setNote] = useState("");
  const copy = () => {
    setNote("");
    const failed = () =>
      setNote(
        t({
          id: "officeAddin.word.proposal.copyFailed",
          message: "The text could not be copied.",
        }),
      );
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- absent outside secure contexts
    if (!navigator.clipboard) {
      failed();
      return;
    }
    try {
      void navigator.clipboard.writeText(text()).then(
        () =>
          setNote(
            t({
              id: "officeAddin.word.proposal.copied",
              message: "Text copied.",
            }),
          ),
        failed,
      );
    } catch {
      failed();
    }
  };
  return (
    <>
      <p className="word-review__hint">
        {documentName
          ? t({
              id: "officeAddin.word.proposal.fromDocument",
              message: `From Word · ${documentName}`,
            })
          : t({
              id: "officeAddin.word.proposal.fromWord",
              message: "From Word",
            })}
      </p>
      <p className="word-review__hint">
        {t({
          id: "officeAddin.word.proposal.openInWord",
          message: "Open this chat in Word with the document to apply.",
        })}
      </p>
      <div className="word-review__actions">
        <Button type="button" variant="secondary" onClick={copy}>
          {t({ id: "officeAddin.word.proposal.copy", message: "Copy text" })}
        </Button>
      </div>
      {note && (
        <p role="status" className="word-review__hint">
          {note}
        </p>
      )}
    </>
  );
}
