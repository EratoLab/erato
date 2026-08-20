import { t } from "@lingui/core/macro";

import { OpenNewWindowIcon } from "@/components/ui/icons";
import { useSidecarLocalTrace } from "@/lib/desktopSidecar/localTraceStore";
import { getChatUrl } from "@/utils/chat/urlUtils";

import { NestedTraceView } from "../NestedTraceView";
import { TraceStep } from "../TraceStep";
import { railIconFor } from "../icons";
import { SettledInfoPill, ToolStatusPill } from "./ToolStatusPill";

import type { ToolApprovalStatus } from "../Trace";
import type { BaseStepProps, TraceStepStatus } from "../types";
import type { DelegationEnvelope } from "@/lib/delegation/delegationEnvelope";
import type { ToolUse } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

interface DelegationStepProps extends BaseStepProps {
  part: ToolUse & { content_type: "tool_use" };
  envelope: DelegationEnvelope;
  approvalStatus?: ToolApprovalStatus;
}

/** The delegate's answer is quoted, not reproduced — the run itself is a click away. */
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

const stepTitle = (name: string | undefined, isRunning: boolean): string => {
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
      return undefined;
    case "failed":
      return t({ id: "trace.tool.failed", message: "Failed" });
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
  return envelope.status === "completed" ? "done" : "error";
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

const OpenDelegatedRunLink = ({
  chatId,
  assistantId,
}: {
  chatId: string;
  assistantId: string | undefined;
}) => {
  const label = t({
    id: "trace.delegation.openRun",
    message: "Open delegated run",
  });
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
  const stepStatus = stepStatusFor(envelope, status);
  const isRunning = stepStatus === "running" && isStreaming;
  const nested = trace && trace.steps.length > 0 ? trace : undefined;
  const outcome =
    envelope.status !== undefined ? outcomeLabel(envelope.status) : undefined;
  const preview = resultPreview(envelope.result);
  const hasSummary = preview !== undefined || envelope.truncated;

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
        title={stepTitle(envelope.assistantName, isRunning)}
        titleSlot={
          envelope.background ? (
            // The detachment is the one thing worth saying about this step —
            // it outranks even an approval decision. The part is frozen at
            // dispatch and never learns the run's fate, so the default copy
            // states the hand-off, not a live state.
            <SettledInfoPill
              label={t({
                id: "trace.delegation.background",
                message: "Sent to background",
              })}
            />
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
