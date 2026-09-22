import { t } from "@lingui/core/macro";

import { Button } from "@/components/ui/Controls/Button";
import { OpenNewWindowIcon } from "@/components/ui/icons";
import { useDelegatedRunLiveStatus } from "@/hooks/chat/useDelegatedRunLiveStatus";
import { useDelegatedRunRetry } from "@/hooks/chat/useDelegatedRunRetry";
import { DELEGATE_TASK_TOOL_NAME } from "@/lib/delegation/delegationEnvelope";
import { delegationReasonLabel } from "@/lib/delegation/delegationLabels";
import {
  TASK_BRIEF_PREVIEW_CHARS,
  taskBriefFromInput,
} from "@/lib/delegation/taskBrief";
import { useSidecarLocalTrace } from "@/lib/desktopSidecar/localTraceStore";
import { useDelegatedRunOpener } from "@/providers/DelegatedRunOpenProvider";
import { getChatUrl } from "@/utils/chat/urlUtils";

import { NestedTraceView } from "../NestedTraceView";
import { TraceStep } from "../TraceStep";
import { railIconFor } from "../icons";
import { SettledInfoPill, ToolStatusPill } from "./ToolStatusPill";

import type { ToolApprovalStatus } from "../Trace";
import type { BaseStepProps, TraceStepStatus } from "../types";
import type { DelegationEnvelope } from "@/lib/delegation/delegationEnvelope";
import type { ToolUse } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ChatAttentionStatus } from "@/utils/chatHistoryGrouping";

interface DelegationStepProps extends BaseStepProps {
  part: ToolUse & { content_type: "tool_use" };
  envelope: DelegationEnvelope;
  approvalStatus?: ToolApprovalStatus;
}

/**
 * The delegate's answer is quoted, not reproduced — the run itself is a click
 * away. The brief is quoted for the same reason, but at the length every
 * surface quoting a brief shares: `TASK_BRIEF_PREVIEW_CHARS`.
 */
const RESULT_PREVIEW_CHARS = 280;

const stepLabel = (id: string): string =>
  id === "answer"
    ? t({ id: "trace.delegation.step.answer", message: "Final answer" })
    : id;

const headline = (summary: string): string =>
  t({
    id: "trace.delegation.traceHeadline",
    message: `Delegated run: ${summary}`,
  });

/**
 * What the step says it is doing. The route is read off the tool name, never
 * off the envelope's identity: under the default persona a task child speaks
 * as the origin chat's assistant, so it carries an assistant name exactly
 * like an @-mention run and the two are indistinguishable by identity alone.
 */
const stepTitle = (
  toolName: string | undefined,
  name: string | undefined,
  isRunning: boolean,
  isQueued: boolean,
): string => {
  if (toolName === DELEGATE_TASK_TOOL_NAME) {
    // A queued slot has no child yet, so neither the running nor the past
    // tense is true of it. Only the task route can queue.
    if (isQueued) {
      return t({ id: "trace.delegation.task.queued", message: "Task queued" });
    }
    return isRunning
      ? t({ id: "trace.delegation.task.running", message: "Running a task" })
      : t({ id: "trace.delegation.task.done", message: "Ran a task" });
  }
  if (name === undefined) {
    return isRunning
      ? t({
          id: "trace.delegation.running.unnamed",
          message: "Delegating to an assistant",
        })
      : t({
          id: "trace.delegation.done.unnamed",
          message: "Delegated to an assistant",
        });
  }
  return isRunning
    ? t({ id: "trace.delegation.running", message: `Delegating to ${name}` })
    : t({ id: "trace.delegation.done", message: `Delegated to ${name}` });
};

/** Outcomes worth spelling out; a completed run is already said by the rail. */
const outcomeLabel = (status: string): string | undefined => {
  switch (status) {
    case "completed":
    case "dispatched":
      return undefined;
    case "working":
      return t({ id: "trace.tool.running", message: "Running" });
    case "failed":
      return t({ id: "trace.tool.failed", message: "Failed" });
    // Retired in favour of `cancelled` + `reason: "timeout"`, but parts
    // persisted before that change replay forever and keep their own word.
    case "timeout":
      return t({ id: "trace.delegation.status.timeout", message: "Timed out" });
    case "cancelled":
      return t({
        id: "trace.delegation.status.cancelled",
        message: "Cancelled",
      });
    default:
      return status;
  }
};

/**
 * Pill for a run that is neither in flight nor finished — states the rail has
 * no glyph for. `stepStatusFor` deliberately keeps those steps out of the
 * error tone, so the pill is what carries the news.
 */
const pendingPill = (
  status: string,
): { label: string; toneClassName?: string } | undefined => {
  switch (status) {
    case "queued":
      return {
        label: t({ id: "trace.delegation.status.queued", message: "Queued" }),
      };
    case "input_required":
      return {
        label: t({
          id: "trace.delegation.status.inputRequired",
          message: "Needs your decision",
        }),
        toneClassName: "bg-theme-warning-bg text-theme-warning-fg",
      };
    default:
      return undefined;
  }
};

const stepStatusFor = (
  envelope: DelegationEnvelope,
  status: TraceStepStatus,
): TraceStepStatus => {
  // A detached dispatch is settled the moment it exists; its part will never
  // report the outcome, so "done" here means the hand-off, not the run.
  if (envelope.background) {
    return "done";
  }
  if (envelope.status === undefined) {
    return status;
  }
  switch (envelope.status) {
    case "completed":
    case "dispatched":
      return "done";
    case "failed":
    case "cancelled":
    case "timeout":
      return "error";
    // Alive, or waiting on someone. None of these is a failure, and the rail
    // has only three states, so they inherit the step's own status and say
    // what they are in the pill instead.
    case "working":
    case "queued":
    case "input_required":
    default:
      return status;
  }
};

/**
 * What the pill on a backgrounded dispatch says. The part itself is frozen
 * at launch, so the default copy states the hand-off; when this client
 * happens to know the run's real state — via the generation-status store or
 * a cached recent-chats row — the truthful state overlays it, resolved by
 * the same resolver as the delegated-runs list so the two surfaces cannot
 * disagree about one run.
 */
const backgroundPill = (
  liveStatus: ChatAttentionStatus | null,
): { label: string; toneClassName?: string } => {
  switch (liveStatus) {
    // A parked approval still means the run is alive and working towards an
    // outcome; the finer distinction belongs to the runs list, not here.
    case "running":
    case "action_required":
      return {
        label: t({
          id: "trace.delegation.background.running",
          message: "Running in the background",
        }),
        toneClassName: "bg-theme-info-bg text-theme-info-fg animate-pulse",
      };
    case "finished":
      return {
        label: t({
          id: "trace.delegation.background.finished",
          message: "Finished in the background",
        }),
        toneClassName: "bg-theme-success-bg text-theme-success-fg",
      };
    case "error":
      return {
        label: t({
          id: "trace.delegation.background.failed",
          message: "Failed in the background",
        }),
        toneClassName: "bg-theme-error-bg text-theme-error-fg",
      };
    default:
      return {
        label: t({
          id: "trace.delegation.background",
          message: "Sent to background",
        }),
      };
  }
};

const resultPreview = (result: string | undefined): string | undefined => {
  const text = result?.trim();
  if (!text) {
    return undefined;
  }
  const characters = [...text];
  return characters.length > RESULT_PREVIEW_CHARS
    ? `${characters.slice(0, RESULT_PREVIEW_CHARS).join("")}…`
    : text;
};

/**
 * Offer to run a failed task again, from the slot where it failed.
 *
 * Its own component, mounted only on the failed branch, because the hook it
 * calls needs a feature-config provider and a query client; called
 * unconditionally it would make every surface that renders any delegation step
 * owe both for a control almost no step shows.
 *
 * The copy has to state the retry's shape, not just offer it. This slot was
 * frozen at dispatch and will never be rewritten, and the retry is always an
 * async task — so its answer arrives as a delivered result later, not here.
 * Left unsaid, the reader waits on a step that can never update.
 */
const RetryTaskControl = ({ childChatId }: { childChatId: string }) => {
  // The origin is the chat this trace is being read in, which is where the
  // run was dispatched from — so the hook's default is exactly right here.
  const { enabled, retriedByChatId, isRetrying, refusal, retry } =
    useDelegatedRunRetry(childChatId);

  if (!enabled) {
    return null;
  }

  if (retriedByChatId !== undefined) {
    return (
      <p data-testid="delegation-retried">
        {t({
          id: "trace.delegation.retried",
          message: "Retried as a background task.",
        })}
      </p>
    );
  }

  return (
    <div
      className="flex flex-wrap items-center gap-x-2"
      data-testid="delegation-retry"
    >
      <Button
        variant="link"
        size="sm"
        loading={isRetrying}
        onClick={retry}
        data-testid="delegation-retry-action"
      >
        {t({ id: "trace.delegation.retry", message: "Retry task" })}
      </Button>
      <span>
        {t({
          id: "trace.delegation.retry.background",
          message:
            "The retry runs as a background task; its answer arrives separately, not in this step.",
        })}
      </span>
      {refusal !== null && (
        <span data-testid="delegation-retry-refused">
          {t({
            id: "trace.delegation.retry.failed",
            message: "This task cannot be retried",
          })}
        </span>
      )}
    </div>
  );
};

const OpenDelegatedRunLink = ({
  chatId,
  assistantId,
}: {
  chatId: string;
  assistantId: string | undefined;
}) => {
  const openRun = useDelegatedRunOpener();
  const label = t({
    id: "trace.delegation.openRun",
    message: "Open delegated run",
  });
  if (openRun) {
    return (
      <button
        type="button"
        onClick={() => openRun(chatId)}
        aria-label={label}
        title={label}
        data-testid="delegation-open-run"
        className="focus-ring-tight inline-flex size-5 shrink-0 items-center justify-center rounded-[var(--theme-radius-base)] text-theme-fg-muted hover:text-theme-fg-primary"
      >
        <OpenNewWindowIcon className="size-3.5" />
      </button>
    );
  }
  return (
    <a
      href={getChatUrl(chatId, assistantId)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
      data-testid="delegation-open-run"
      className="focus-ring-tight inline-flex size-5 shrink-0 items-center justify-center rounded-[var(--theme-radius-base)] text-theme-fg-muted hover:text-theme-fg-primary"
    >
      <OpenNewWindowIcon className="size-3.5" />
    </a>
  );
};

/**
 * A `delegate_to_assistant` call: the delegate's own steps nested under the
 * step that started them, plus a way into the run itself. The steps arrive on
 * the tool output, republished whole with every progress frame, so this
 * renders the same live, on resume, and after a reload.
 */
export const DelegationStep = ({
  part,
  status,
  isStreaming,
  isCollapsed,
  isLastStep,
  approvalStatus,
  envelope,
}: DelegationStepProps) => {
  const trace = useSidecarLocalTrace(
    part.tool_call_id,
    part.tool_name,
    part.output,
  );
  const liveStatus = useDelegatedRunLiveStatus(
    envelope.background ? envelope.delegateChatId : undefined,
  );
  const stepStatus = stepStatusFor(envelope, status);
  // A queued slot inherits the rail's "running", because the rail has only
  // three states — but nothing about it is in flight, so it must not pulse
  // or call itself running in the title.
  const isQueued = envelope.status === "queued";
  const isRunning = stepStatus === "running" && isStreaming && !isQueued;
  const nested = trace && trace.steps.length > 0 ? trace : undefined;
  const outcome =
    envelope.status !== undefined ? outcomeLabel(envelope.status) : undefined;
  const pending =
    envelope.status !== undefined ? pendingPill(envelope.status) : undefined;
  // Only the task route: a mention step already names the assistant it
  // delegated to, and its brief would just repeat the conversation.
  const brief =
    part.tool_name === DELEGATE_TASK_TOOL_NAME
      ? taskBriefFromInput(part.input, TASK_BRIEF_PREVIEW_CHARS)
      : undefined;
  const preview = resultPreview(envelope.result);
  // Any reason the backend sends is shown. A `completed` run is exactly where
  // the interesting ones ride — a run that answered nothing, or one that
  // stopped at its budget with a partial answer — and those are the cases the
  // rail's green check would otherwise report as an unqualified success.
  const why =
    envelope.reason !== undefined
      ? delegationReasonLabel(envelope.reason)
      : undefined;
  // Only the task route can be retried — a mention child is bound to the
  // assistant it was addressed to, and the endpoint refuses it. The failure
  // may be stated by the frozen envelope itself, or, for a detached dispatch
  // whose slot says nothing, only by what this client knows of the run.
  const retryableChildChatId =
    part.tool_name === DELEGATE_TASK_TOOL_NAME &&
    (envelope.status === "failed" || liveStatus === "error")
      ? envelope.delegateChatId
      : undefined;
  const hasSummary =
    preview !== undefined ||
    envelope.truncated ||
    why !== undefined ||
    brief !== undefined ||
    retryableChildChatId !== undefined;

  const body =
    nested !== undefined || hasSummary ? (
      <div className="space-y-1 py-0.5">
        {nested !== undefined && (
          <NestedTraceView
            trace={nested}
            headline={headline}
            stepLabel={stepLabel}
            testId="delegation-trace"
          />
        )}
        {hasSummary && (
          <div
            className="space-y-0.5 pb-1 pl-2.5 text-xs text-theme-fg-muted"
            data-testid="delegation-result"
          >
            {brief !== undefined && (
              <p
                className="italic text-theme-fg-muted"
                data-testid="delegation-brief"
              >
                {brief}
              </p>
            )}
            {why !== undefined && <p data-testid="delegation-reason">{why}</p>}
            {preview !== undefined && (
              <p className="whitespace-pre-wrap">{preview}</p>
            )}
            {envelope.truncated && (
              <p>
                {t({
                  id: "trace.delegation.result.truncated",
                  message: "Result truncated",
                })}
              </p>
            )}
            {retryableChildChatId !== undefined && (
              <RetryTaskControl childChatId={retryableChildChatId} />
            )}
          </div>
        )}
      </div>
    ) : undefined;

  return (
    <div
      data-testid="tool-call-item"
      data-tool-name={part.tool_name ?? ""}
      data-tool-status={part.status}
    >
      <TraceStep
        railIcon={railIconFor(part.content_type, stepStatus)}
        hasTrailingRailLine={!isLastStep}
        title={stepTitle(
          part.tool_name,
          envelope.assistantName,
          isRunning,
          isQueued,
        )}
        titleSlot={
          envelope.background ? (
            // The detachment is the one thing worth saying about this step —
            // it outranks even an approval decision.
            <SettledInfoPill {...backgroundPill(liveStatus)} />
          ) : pending !== undefined ? (
            <SettledInfoPill {...pending} />
          ) : (
            <ToolStatusPill
              status={stepStatus}
              approvalStatus={approvalStatus}
              label={outcome}
            />
          )
        }
        headerSlot={
          envelope.delegateChatId !== undefined ? (
            <OpenDelegatedRunLink
              chatId={envelope.delegateChatId}
              assistantId={envelope.assistantId}
            />
          ) : undefined
        }
        defaultOpen={nested !== undefined}
        autoExpand={nested !== undefined}
        autoCollapse={isCollapsed}
        isActive={isRunning}
      >
        {body}
      </TraceStep>
    </div>
  );
};
