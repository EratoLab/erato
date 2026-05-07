import { t } from "@lingui/core/macro";
import clsx from "clsx";

import { ToolCallInput, ToolCallOutput } from "@/components/ui/ToolCall";

import { TraceStep } from "../TraceStep";
import { railIconFor } from "../icons";

import type { BaseStepProps } from "../types";
import type { ToolUse } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

interface ToolUseStepProps extends BaseStepProps {
  part: ToolUse & { content_type: "tool_use" };
}

// Pills are only shown for states that need extra emphasis beyond the rail
// icon: in-flight (animated) and failed (red attention). The success state is
// already conveyed by the rail's checkmark — no pill needed.
const STATUS_PILL_CLASS = {
  running: "bg-theme-info-bg text-theme-info-fg animate-pulse",
  error: "bg-theme-error-bg text-theme-error-fg",
} as const;

const STATUS_LABEL = {
  running: () => t`Running`,
  error: () => t`Failed`,
} as const;

type StatusWithPill = keyof typeof STATUS_PILL_CLASS;
const hasPill = (status: string): status is StatusWithPill =>
  status === "running" || status === "error";

export const ToolUseStep = ({
  part,
  status,
  isStreaming,
  isCollapsed,
  isLastStep,
}: ToolUseStepProps) => {
  const isRunning = status === "running" && isStreaming;
  const titleSlot = hasPill(status) ? (
    <span
      className={clsx(
        "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
        STATUS_PILL_CLASS[status],
      )}
    >
      {STATUS_LABEL[status]()}
    </span>
  ) : null;

  return (
    // The `data-testid`/`data-tool-name`/`data-tool-status` attributes on the
    // wrapper expose a stable, mode-agnostic test handle. Tests can target a
    // tool call by name regardless of whether the trace is currently expanded
    // (streaming) or collapsed behind the cold-load summary pill — DOM-based
    // locators don't filter by visibility, only presence.
    <div
      data-testid="tool-call-item"
      data-tool-name={part.tool_name}
      data-tool-status={part.status}
    >
      <TraceStep
        railIcon={railIconFor(part.content_type, status)}
        hasTrailingRailLine={!isLastStep}
        title={part.tool_name}
        titleSlot={titleSlot}
        defaultOpen={false}
        autoCollapse={isCollapsed}
        isActive={isRunning}
      >
        <div className="space-y-3 py-2">
          {part.input != null && <ToolCallInput input={part.input} />}
          {part.output != null && (
            <ToolCallOutput output={part.output} isError={status === "error"} />
          )}
        </div>
      </TraceStep>
    </div>
  );
};
