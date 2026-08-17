import { t } from "@lingui/core/macro";
import clsx from "clsx";

import { ToolCallInput, ToolCallOutput } from "@/components/ui/ToolCall";
import { useSidecarLocalTrace } from "@/lib/desktopSidecar/localTraceStore";

import { SidecarLocalTraceSubtree } from "../SidecarLocalTraceSubtree";
import { TraceStep } from "../TraceStep";
import { railIconFor } from "../icons";

import type { ToolApprovalStatus } from "../Trace";
import type { BaseStepProps, TraceStepStatus } from "../types";
import type { ToolUse } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

interface ToolUseStepProps extends BaseStepProps {
  part: ToolUse & { content_type: "tool_use" };
  approvalStatus?: ToolApprovalStatus;
}

// Pills are only shown for states that need extra emphasis beyond the rail
// icon: in-flight (animated) and failed (red attention). The success state is
// already conveyed by the rail's checkmark — no pill needed.
const STATUS_PILL_CLASS = {
  running: "bg-theme-info-bg text-theme-info-fg animate-pulse",
  error: "bg-theme-error-bg text-theme-error-fg",
} as const;

const STATUS_LABEL = {
  running: () => t({ id: "trace.tool.running", message: "Running" }),
  error: () => t({ id: "trace.tool.failed", message: "Failed" }),
} as const;

const APPROVAL_PILL = {
  approved: {
    className: "bg-theme-success-bg text-theme-success-fg",
    label: () => t({ id: "trace.tool.approved", message: "Approved" }),
  },
  denied: {
    className: "bg-theme-error-bg text-theme-error-fg",
    label: () => t({ id: "trace.tool.denied", message: "Denied" }),
  },
} as const;

type StatusWithPill = keyof typeof STATUS_PILL_CLASS;
const hasPill = (status: TraceStepStatus): status is StatusWithPill =>
  status === "running" || status === "error";

export const ToolUseStep = ({
  part,
  status,
  isStreaming,
  isCollapsed,
  isLastStep,
  approvalStatus,
}: ToolUseStepProps) => {
  const resolvedStatus = part.status;
  const isRunning = status === "running" && isStreaming;
  const toolName = part.tool_name ?? "";
  const toolCallId = part.tool_call_id;

  // The sidecar's on-device steps are the step's body: rows like the main
  // line, each with its own toggle for its own details. This step's toggle
  // folds and unfolds them, open by default so they stream in visibly. A
  // trace-bearing call shows no tool-level payload JSON at all — real input
  // and output only ever belong to an individual step.
  const hasTrace =
    useSidecarLocalTrace(toolCallId, toolName, part.output) !== undefined;
  const titleSlot = approvalStatus ? (
    <span
      className={clsx(
        "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
        APPROVAL_PILL[approvalStatus].className,
      )}
    >
      {APPROVAL_PILL[approvalStatus].label()}
    </span>
  ) : hasPill(status) ? (
    <span
      className={clsx(
        "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
        STATUS_PILL_CLASS[status],
      )}
    >
      {STATUS_LABEL[status]()}
    </span>
  ) : null;

  const body =
    toolCallId && hasTrace ? (
      <SidecarLocalTraceSubtree
        toolCallId={toolCallId}
        toolName={toolName}
        output={part.output}
      />
    ) : part.input != null || part.output != null ? (
      <div className="space-y-3 py-2">
        {part.input != null && <ToolCallInput input={part.input} />}
        {part.output != null && (
          <ToolCallOutput output={part.output} isError={status === "error"} />
        )}
      </div>
    ) : undefined;

  return (
    // The `data-testid`/`data-tool-name`/`data-tool-status` attributes on the
    // wrapper expose a stable, mode-agnostic test handle. Tests can target a
    // tool call by name regardless of whether the trace is currently expanded
    // (streaming) or collapsed behind the cold-load summary pill — DOM-based
    // locators don't filter by visibility, only presence.
    <div
      data-testid="tool-call-item"
      data-tool-name={toolName}
      data-tool-status={resolvedStatus}
    >
      <TraceStep
        railIcon={railIconFor(part.content_type, status)}
        hasTrailingRailLine={!isLastStep}
        title={toolName}
        titleSlot={titleSlot}
        defaultOpen={hasTrace}
        autoExpand={hasTrace}
        autoCollapse={isCollapsed}
        isActive={isRunning}
      >
        {body}
      </TraceStep>
    </div>
  );
};
