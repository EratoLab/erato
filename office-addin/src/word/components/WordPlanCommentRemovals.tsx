import { Button } from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useId } from "react";

import { WordApplyButton } from "./WordReviewCardParts";
import {
  wordCommentPointText,
  wordCommentQuote,
  wordCommentRemovalsIntroText,
  wordCommentRemovalsTickText,
  wordCommentRepliesText,
  wordCommentThreadStatusText,
} from "../utils/wordPlanCommentMessages";

import type { WordApplyStage } from "../utils/wordApplyProgress";
import type { WordPlanCommentRemoval } from "@erato/frontend/word-review";
import type { ReactNode } from "react";

/**
 * The comment threads a plan deletes, one row per thread, and the unticked box that consents to
 * deleting them. The box is the only consent: Always allow and auto-prompt never tick it (X-4).
 */
export function WordPlanCommentRemovals({
  removals,
  confirmed,
  disabled,
  onConfirmedChange,
  onKeepPassages,
  onCopyThreads,
}: {
  removals: readonly WordPlanCommentRemoval[];
  confirmed: boolean;
  disabled: boolean;
  onConfirmedChange: (confirmed: boolean) => void;
  onKeepPassages: () => void;
  /** Absent where another button on the card copies these threads already. */
  onCopyThreads?: () => void;
}) {
  const listId = useId();
  return (
    <div
      role="group"
      aria-label={t({
        id: "officeAddin.word.planComments.label",
        message: "Comment threads this change deletes",
      })}
      className="grid gap-2"
      data-testid="word-plan-comment-removals"
    >
      <p className="text-sm text-theme-fg-primary">
        {wordCommentRemovalsIntroText(removals.length)}
      </p>
      <ul id={listId} className="grid gap-1 text-sm text-theme-fg-primary">
        {removals.map(({ thread }) => (
          <li
            key={thread.wId}
            className="rounded border border-theme-border px-2 py-1 [overflow-wrap:anywhere]"
            data-testid="word-plan-comment-thread"
          >
            <span className="font-medium">{thread.author}</span>
            {" · "}
            {wordCommentThreadStatusText(thread.resolved)}
            {" · "}
            {wordCommentRepliesText(thread.replies.length)}
            <span className="block text-theme-fg-secondary">
              {thread.quote
                ? `“${wordCommentQuote(thread.quote)}”`
                : wordCommentPointText()}
            </span>
          </li>
        ))}
      </ul>
      <label className="flex cursor-pointer items-start gap-2">
        <input
          type="checkbox"
          checked={confirmed}
          disabled={disabled}
          aria-describedby={listId}
          onChange={(event) => onConfirmedChange(event.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-[var(--theme-fg-accent)] focus:ring-theme-fg-accent focus:ring-offset-0"
        />
        <span className="text-sm text-theme-fg-primary">
          {wordCommentRemovalsTickText(removals.length)}
        </span>
      </label>
      <div className="word-review__actions">
        <Button
          type="button"
          variant="secondary"
          disabled={disabled}
          onClick={onKeepPassages}
        >
          {t({
            id: "officeAddin.word.planComments.keep",
            message: "Keep commented passages",
          })}
        </Button>
        {onCopyThreads && (
          <Button
            type="button"
            variant="secondary"
            disabled={disabled}
            onClick={onCopyThreads}
          >
            {t({
              id: "officeAddin.word.planComments.copy",
              message: "Copy these threads",
            })}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Apply for a plan that deletes comment threads and replaces nothing that asks first. */
export function WordPlanCommentConfirm({
  removals,
  confirmed,
  onConfirmedChange,
  routeText,
  notice,
  applyLabel,
  canApply,
  applying,
  applyStage,
  onApply,
  onKeepPassages,
  onCopyThreads,
  onCancel,
}: {
  removals: readonly WordPlanCommentRemoval[];
  confirmed: boolean;
  onConfirmedChange: (confirmed: boolean) => void;
  routeText: string | undefined;
  notice?: ReactNode;
  applyLabel: string;
  canApply: boolean;
  applying: boolean;
  applyStage: WordApplyStage | undefined;
  onApply: () => void;
  onKeepPassages: () => void;
  onCopyThreads: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="grid gap-2">
      {routeText && (
        <p className="word-review__hint" data-testid="word-plan-route">
          {routeText}
        </p>
      )}
      {notice}
      <WordPlanCommentRemovals
        removals={removals}
        confirmed={confirmed}
        disabled={applying}
        onConfirmedChange={onConfirmedChange}
        onKeepPassages={onKeepPassages}
        onCopyThreads={onCopyThreads}
      />
      <div className="word-review__actions">
        <WordApplyButton
          applying={applying}
          applyStage={applyStage}
          disabled={!confirmed || !canApply}
          label={applyLabel}
          onApply={() => {
            if (confirmed) onApply();
          }}
        />
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
