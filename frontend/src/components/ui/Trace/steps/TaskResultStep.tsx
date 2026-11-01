import { t } from "@lingui/core/macro";
import { useCallback } from "react";

import { Button } from "@/components/ui/Controls/Button";
import { useConversationSelector } from "@/components/ui/Message/ConversationMessages";
import {
  OpenDelegatedRunLink,
  RetryTaskControl,
  resultPreview,
} from "@/lib/delegation/delegatedRunControls";
import { delegationReasonLabel } from "@/lib/delegation/delegationLabels";
import { localTaskLabel } from "@/lib/desktopSidecar/localTaskLabels";
import { useLocalTaskViewsStore } from "@/lib/desktopSidecar/localTaskViewsStore";
import { useDelegatedRunOpener } from "@/providers/DelegatedRunOpenProvider";
import { hasLaterTaskResult } from "@/utils/chat/taskResultFolds";
import { getChatUrl } from "@/utils/chat/urlUtils";

import { TraceStep } from "../TraceStep";
import { railIconFor } from "../icons";
import { SettledInfoPill, ToolStatusPill } from "./ToolStatusPill";

import type { TraceStepStatus } from "../types";
import type { LocalTaskViewState } from "@/lib/desktopSidecar/localTaskCoordinator";
import type { ContentPartTaskResult } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const WARNING_TONE = "bg-theme-warning-bg text-theme-warning-fg";

const railStatusFor = (status: string): TraceStepStatus => {
  switch (status) {
    case "failed":
    case "cancelled":
      return "error";
    // The waiting glyph, without the pulse: nothing runs until the user answers.
    case "input_required":
      return "running";
    default:
      return "done";
  }
};

const statusPill = (status: string) => {
  switch (status) {
    case "completed":
      return null;
    case "input_required":
      return (
        <SettledInfoPill
          label={t({
            id: "trace.delegation.status.inputRequired",
            message: "Needs your decision",
          })}
          toneClassName={WARNING_TONE}
        />
      );
    case "failed":
      return (
        <ToolStatusPill
          status="error"
          label={t({ id: "trace.tool.failed", message: "Failed" })}
        />
      );
    case "cancelled":
      return (
        <ToolStatusPill
          status="error"
          label={t({
            id: "trace.delegation.status.cancelled",
            message: "Cancelled",
          })}
        />
      );
    default:
      return <SettledInfoPill label={status} />;
  }
};

/**
 * A local-evidence task waits for its review in the Erato desktop app, not for
 * an answer in its chat. This device names the native state while it knows
 * the job, which it forgets once the job is acknowledged; otherwise the line
 * claims no wait.
 */
const localReviewPill = (
  state: LocalTaskViewState | undefined,
  replaced: boolean,
) => (
  <SettledInfoPill
    label={
      state !== undefined
        ? localTaskLabel(state)
        : replaced
          ? t({
              id: "trace.taskResult.replacedByLaterReport",
              message: "Replaced by a later report",
            })
          : t({
              id: "trace.taskResult.localReview",
              message: "Review in the Erato desktop app",
            })
    }
    toneClassName={state === "ready_for_review" ? WARNING_TONE : undefined}
  />
);

interface TaskResultStepProps {
  part: ContentPartTaskResult;
  /**
   * True when the assistant's reply to this result is drawn right below it.
   * The reply restates the answer, so a completed step then starts collapsed
   * and quotes it instead of repeating it in full.
   */
  hasReply?: boolean;
}

/**
 * A delegated task's result, drawn as the step where the task reported back
 * into the assistant's turn. The model reads it from a user-role row, which is
 * why the conversation list moves it onto the assistant's side.
 *
 * The answer is the child run's own text, shaped by whatever it read, so it is
 * plain text — never markdown — as in the trace's delegation step.
 */
export const TaskResultStep = ({
  part,
  hasReply = false,
}: TaskResultStepProps) => {
  const openRun = useDelegatedRunOpener();
  const openLabel = t({
    id: "trace.taskResult.openRun",
    message: "Open the task's run",
  });
  // `redeliveries`, not `sequence`: a parked run's real answer arrives at
  // `sequence: 1` and is not a repeat. Older rows carry only `sequence`.
  const isRedelivery =
    part.redeliveries === undefined ? part.sequence > 0 : part.redeliveries > 0;
  const modelName = part.model?.display_name ?? part.model?.chat_provider_id;
  const summary = hasReply ? resultPreview(part.summary) : part.summary.trim();
  // Client tasks always wait for their calls inside the parent's turn, so an
  // async result that waits on the client comes from a local-evidence task.
  const localReview =
    part.status === "input_required" && part.reason === "client_pending";
  const localState = useLocalTaskViewsStore((state) =>
    localReview ? state.byChatId.get(part.child_chat_id) : undefined,
  );
  const { child_chat_id: childChatId, sequence } = part;
  const selectReplaced = useCallback(
    (messages: Parameters<typeof hasLaterTaskResult>[0]) =>
      localReview && hasLaterTaskResult(messages, childChatId, sequence),
    [localReview, childChatId, sequence],
  );
  const replaced = useConversationSelector(selectReplaced, Object.is);
  const settled = replaced && localState === undefined;
  const pill = localReview
    ? localReviewPill(localState, replaced)
    : statusPill(part.status);
  const needsAttention = part.status !== "completed" && !settled;
  const railStatus = settled ? "done" : railStatusFor(part.status);

  return (
    <div
      data-testid="task-result-step"
      data-task-result-status={part.status}
      className="my-2 min-w-0"
    >
      <TraceStep
        // eslint-disable-next-line lingui/no-unlocalized-strings -- content type
        railIcon={railIconFor("task_result", railStatus)}
        hasTrailingRailLine={false}
        title={t({
          id: "trace.taskResult.title",
          message: "Task reported back",
        })}
        titleSlot={
          <>
            {pill !== null && (
              <span data-testid="task-result-status" className="contents">
                {pill}
              </span>
            )}
            {isRedelivery && (
              <span
                data-testid="task-result-sequence"
                className="shrink-0 text-xs text-theme-fg-muted"
              >
                {t({
                  id: "trace.taskResult.redelivered",
                  message: "Delivered again",
                })}
              </span>
            )}
          </>
        }
        headerSlot={
          <OpenDelegatedRunLink
            chatId={part.child_chat_id}
            label={openLabel}
            testId="task-result-open-run"
          />
        }
        defaultOpen={needsAttention || !hasReply}
      >
        <div
          className="space-y-0.5 pb-1 pl-2.5 pt-0.5 text-xs text-theme-fg-muted"
          data-testid="task-result-body"
        >
          {part.reason !== undefined && !localReview && (
            <p data-testid="task-result-reason">
              {delegationReasonLabel(part.reason)}
            </p>
          )}
          {modelName !== undefined && (
            <p data-testid="task-result-model">
              {t({
                id: "trace.delegation.model",
                message: `Model: ${modelName}`,
              })}
            </p>
          )}
          {part.model?.unavailable_chat_provider_id !== undefined && (
            <p data-testid="task-result-model-unavailable">
              {t({
                id: "trace.delegation.model.unavailable",
                message: `The model set up for this task is not available to you, so it ran on ${modelName}.`,
              })}
            </p>
          )}
          {/* The question waits in the run's own chat; nothing here can answer it. */}
          {part.status === "input_required" && !settled && (
            <p data-testid="task-result-input-required">
              {localReview
                ? t({
                    id: "trace.taskResult.followInTaskChat",
                    message: "Follow it in the task's own chat:",
                  })
                : t({
                    id: "trace.taskResult.inputRequired",
                    message: "Answer it in the task's own chat:",
                  })}{" "}
              {openRun ? (
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => openRun(part.child_chat_id)}
                  data-testid="task-result-input-required-open"
                >
                  {openLabel}
                </Button>
              ) : (
                <a
                  href={getChatUrl(part.child_chat_id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="task-result-input-required-open"
                  className="focus-ring-tight underline"
                >
                  {openLabel}
                </a>
              )}
            </p>
          )}
          {summary && (
            <p
              data-testid="task-result-summary"
              className="whitespace-pre-wrap text-theme-fg-secondary"
            >
              {summary}
            </p>
          )}
          {part.truncated && (
            <p data-testid="task-result-truncated">
              {t({
                id: "trace.delegation.result.truncated",
                message: "Result truncated",
              })}
            </p>
          )}
          {/* Only a failed run may be retried; re-running a completed one would
              start a task behind the user's back. */}
          {part.status === "failed" && (
            <RetryTaskControl
              childChatId={part.child_chat_id}
              testIdPrefix="task-result"
            />
          )}
        </div>
      </TraceStep>
    </div>
  );
};

/** @deprecated A delivered result is drawn as {@link TaskResultStep}. */
export const TaskResultCard = TaskResultStep;
