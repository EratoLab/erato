import { Alert, Button } from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useId, useState } from "react";

import { WordApplyButton } from "./WordReviewCardParts";
import { wordWholeDocumentRefusalText } from "../utils/wordAuthoringMessages";

import type { WordApplyStage } from "../utils/wordApplyProgress";
import type { WordWholeDocumentRefusal } from "../utils/wordInPlaceRoute";
import type { ReactNode } from "react";

function AskAgainButton({
  disabled,
  onAskAgain,
}: {
  disabled?: boolean;
  onAskAgain: () => void;
}) {
  return (
    <Button
      type="button"
      variant="secondary"
      disabled={disabled}
      onClick={onAskAgain}
    >
      {t({
        id: "officeAddin.word.importConfirm.askAgain",
        message: "Ask again for in-place edits",
      })}
    </Button>
  );
}

/**
 * Apply for a plan that replaces the whole document where the host's policy asks first. The box
 * starts unticked for every plan, and Always allow never ticks it.
 */
export function WordImportConfirm({
  routeText,
  web,
  notice,
  comments,
  commentsConfirmed = true,
  applyLabel,
  canApply,
  applying,
  applyStage,
  onApply,
  onAskAgain,
  onCancel,
}: {
  routeText: string | undefined;
  /** Word for the web cannot undo the import, rewrites comment metadata with it, and leaves a
   * result that does not verify (ERMAIN-961 gate, F2). */
  web: boolean;
  /** Shown after the route, such as Word reporting others in the document. */
  notice?: ReactNode;
  /** The comment threads the plan deletes, with their own tick. */
  comments?: ReactNode;
  /** That tick, which Apply needs as well. */
  commentsConfirmed?: boolean;
  applyLabel: string;
  canApply: boolean;
  applying: boolean;
  applyStage: WordApplyStage | undefined;
  onApply: () => void;
  onAskAgain: () => void;
  onCancel: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const statementsId = useId();
  const statements = [
    web
      ? t({
          id: "officeAddin.word.importConfirm.undo",
          message:
            "Word's Undo can't reverse this change. Erato can't verify the result on Word for the web, and its Restore may not bring back the exact original, which stays available to download.",
        })
      : t({
          id: "officeAddin.word.importConfirm.eratoUndo",
          message: "Erato's Undo works only until someone edits the document.",
        }),
    t({
      id: "officeAddin.word.importConfirm.coauthors",
      message: "People editing at the same time may lose their latest changes.",
    }),
    ...(web
      ? [
          t({
            id: "officeAddin.word.importConfirm.comments",
            message: "Comment dates and resolved flags may change.",
          }),
        ]
      : []),
  ];
  return (
    <div
      role="group"
      aria-label={t({
        id: "officeAddin.word.importConfirm.label",
        message: "Confirm replacing the whole document",
      })}
      className="grid gap-2"
    >
      {routeText && (
        <p className="word-review__hint" data-testid="word-plan-route">
          {routeText}
        </p>
      )}
      {notice}
      <ul
        id={statementsId}
        className="list-disc space-y-1 ps-5 text-sm text-theme-fg-primary"
      >
        {statements.map((statement) => (
          <li key={statement}>{statement}</li>
        ))}
      </ul>
      <label className="flex cursor-pointer items-start gap-2">
        <input
          type="checkbox"
          checked={confirmed}
          disabled={applying}
          aria-describedby={statementsId}
          onChange={(event) => setConfirmed(event.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-[var(--theme-fg-accent)] focus:ring-theme-fg-accent focus:ring-offset-0"
        />
        <span className="text-sm text-theme-fg-primary">
          {t({
            id: "officeAddin.word.importConfirm.tick",
            message: "I understand. Replace the whole document.",
          })}
        </span>
      </label>
      {comments}
      <div className="word-review__actions">
        <WordApplyButton
          applying={applying}
          applyStage={applyStage}
          disabled={!confirmed || !commentsConfirmed || !canApply}
          label={applyLabel}
          onApply={() => {
            if (confirmed && commentsConfirmed) onApply();
          }}
        />
        <AskAgainButton disabled={applying} onAskAgain={onAskAgain} />
        <Button
          type="button"
          variant="secondary"
          disabled={applying}
          onClick={onCancel}
        >
          {t({ id: "officeAddin.word.review.cancel", message: "Cancel" })}
        </Button>
      </div>
    </div>
  );
}

/** In place of Apply where the host's policy rules out replacing the whole document for this plan. */
export function WordImportRefusal({
  reason,
  onAskAgain,
}: {
  reason: WordWholeDocumentRefusal;
  onAskAgain: () => void;
}) {
  return (
    <>
      <Alert type="info" role="status" className="[overflow-wrap:anywhere]">
        {wordWholeDocumentRefusalText(reason)}
      </Alert>
      <div className="word-review__actions">
        <AskAgainButton onAskAgain={onAskAgain} />
      </div>
    </>
  );
}
