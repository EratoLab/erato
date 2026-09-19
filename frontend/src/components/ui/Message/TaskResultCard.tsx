import { t } from "@lingui/core/macro";

import { Button } from "@/components/ui/Controls/Button";
import { OpenNewWindowIcon } from "@/components/ui/icons";
import { useDelegatedRunRetry } from "@/hooks/chat/useDelegatedRunRetry";
import { delegationReasonLabel } from "@/lib/delegation/delegationLabels";
import { useDelegatedRunOpener } from "@/providers/DelegatedRunOpenProvider";
import { getChatUrl } from "@/utils/chat/urlUtils";

import type { ContentPartTaskResult } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * Headline for the run's outcome. `completed` is the unremarkable case and
 * says nothing beyond the card's own title; everything else is news. An
 * unknown value renders verbatim, matching how the trace handles a vocabulary
 * newer than this client.
 */
const statusLabel = (status: string): string | undefined => {
  switch (status) {
    case "completed":
      return undefined;
    case "failed":
      return t({ id: "message.taskResult.status.failed", message: "Failed" });
    case "cancelled":
      return t({
        id: "message.taskResult.status.cancelled",
        message: "Cancelled",
      });
    default:
      return status;
  }
};

/**
 * Offer to run a failed task again, from the card that reported the failure.
 *
 * Its own component, mounted only when the delivered result says the run
 * failed, because the hook it calls needs a feature-config provider and a
 * query client. This card is rendered bare in several places — including its
 * own tests — and a card for a result that succeeded must not start owing
 * providers for a control it never shows.
 *
 * Like the trace's control, the copy states what a retry actually is: a new
 * background task whose answer is delivered as its own result later. This card
 * is a record of one delivery and is never rewritten.
 */
const RetryTaskControl = ({ childChatId }: { childChatId: string }) => {
  // The result was delivered into the origin conversation, which is the chat
  // this card is being read in — so the hook's default origin is right.
  const { enabled, retriedByChatId, isRetrying, refusal, retry } =
    useDelegatedRunRetry(childChatId);

  if (!enabled) {
    return null;
  }

  if (retriedByChatId !== undefined) {
    return (
      <div className="mt-2 text-xs" data-testid="task-result-retried">
        {t({
          id: "message.taskResult.retried",
          message: "Retried as a background task.",
        })}
      </div>
    );
  }

  return (
    <div
      className="mt-2 flex flex-wrap items-center gap-x-2 text-xs"
      data-testid="task-result-retry"
    >
      <Button
        variant="link"
        size="sm"
        loading={isRetrying}
        onClick={retry}
        data-testid="task-result-retry-action"
      >
        {t({ id: "message.taskResult.retry", message: "Retry task" })}
      </Button>
      <span>
        {t({
          id: "message.taskResult.retry.background",
          message:
            "The retry runs as a background task; its answer arrives as its own result, not in this card.",
        })}
      </span>
      {refusal !== null && (
        <span data-testid="task-result-retry-refused">
          {t({
            id: "message.taskResult.retry.failed",
            message: "This task cannot be retried",
          })}
        </span>
      )}
    </div>
  );
};

/**
 * A delegated task's result, delivered into this conversation by the server
 * rather than written by anyone in it.
 *
 * It rides a user-role row because that is where the model has to read it, so
 * the transcript draws its usual "You" header above this card. The card is
 * therefore self-identifying: it says what it is rather than relying on its
 * surroundings to say it.
 *
 * The summary is the child run's own text, shaped by whatever it read. It is
 * rendered as plain text, never as markdown — the same treatment the trace
 * gives a delegation result, and for the same reason.
 */
export const TaskResultCard = ({ part }: { part: ContentPartTaskResult }) => {
  const openRun = useDelegatedRunOpener();
  const status = statusLabel(part.status);
  const openLabel = t({
    id: "message.taskResult.openRun",
    message: "Open the task's run",
  });

  const openRunAffordance = openRun ? (
    <button
      type="button"
      onClick={() => openRun(part.child_chat_id)}
      aria-label={openLabel}
      title={openLabel}
      data-testid="task-result-open-run"
      className="focus-ring-tight inline-flex size-5 shrink-0 items-center justify-center rounded-[var(--theme-radius-base)] text-theme-fg-muted hover:text-theme-fg-primary"
    >
      <OpenNewWindowIcon className="size-3.5" />
    </button>
  ) : (
    <a
      href={getChatUrl(part.child_chat_id)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={openLabel}
      title={openLabel}
      data-testid="task-result-open-run"
      className="focus-ring-tight inline-flex size-5 shrink-0 items-center justify-center rounded-[var(--theme-radius-base)] text-theme-fg-muted hover:text-theme-fg-primary"
    >
      <OpenNewWindowIcon className="size-3.5" />
    </a>
  );

  return (
    <div
      data-testid="task-result-card"
      data-task-result-status={part.status}
      className="my-2 rounded-[var(--theme-radius-base)] border border-theme-border bg-theme-bg-secondary px-3 py-2 text-theme-fg-muted"
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-theme-fg-primary">
          {t({
            id: "message.taskResult.title",
            message: "Result of a task you delegated",
          })}
        </span>
        {status !== undefined && (
          <span data-testid="task-result-status" className="text-xs">
            {status}
          </span>
        )}
        {/* `sequence` is 0-based: 0 is the first delivery, so anything above
            it means this result reached the conversation more than once. */}
        {part.sequence > 0 && (
          <span data-testid="task-result-sequence" className="text-xs">
            {t({
              id: "message.taskResult.sequence",
              message: "Delivered again",
            })}
          </span>
        )}
        <span className="ml-auto">{openRunAffordance}</span>
      </div>

      {part.reason !== undefined && (
        <div data-testid="task-result-reason" className="mt-1 text-xs">
          {delegationReasonLabel(part.reason)}
        </div>
      )}

      <div
        data-testid="task-result-summary"
        className="mt-2 whitespace-pre-wrap text-sm text-theme-fg-primary"
      >
        {part.summary}
      </div>

      {part.truncated && (
        <div data-testid="task-result-truncated" className="mt-1 text-xs">
          {t({
            id: "message.taskResult.truncated",
            message: "This answer was shortened to fit.",
          })}
        </div>
      )}

      {/* Only a failed run may be retried — a completed one, however
          disappointing its answer, would be re-run behind the user's back. */}
      {part.status === "failed" && (
        <RetryTaskControl childChatId={part.child_chat_id} />
      )}
    </div>
  );
};
