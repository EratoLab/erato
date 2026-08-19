import { ToolCallInput, ToolCallOutput } from "@/components/ui/ToolCall";
import {
  DELEGATION_TOOL_NAME,
  parseDelegationEnvelope,
} from "@/lib/delegation/delegationEnvelope";
import { useSidecarLocalTrace } from "@/lib/desktopSidecar/localTraceStore";

import { SidecarLocalTraceSubtree } from "../SidecarLocalTraceSubtree";
import { TraceStep } from "../TraceStep";
import { railIconFor } from "../icons";
import { DelegationStep } from "./DelegationStep";
import { ToolStatusPill } from "./ToolStatusPill";

import type { ToolApprovalStatus } from "../Trace";
import type { BaseStepProps } from "../types";
import type { ToolUse } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

interface ToolUseStepProps extends BaseStepProps {
  part: ToolUse & { content_type: "tool_use" };
  approvalStatus?: ToolApprovalStatus;
}

const PlainToolUseStep = ({
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
        titleSlot={
          <ToolStatusPill status={status} approvalStatus={approvalStatus} />
        }
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

// A refusal, and every frame before the first progress update, has no run to
// show — those render as the plain tool call. Branching at this level rather
// than inside keeps each rendering free to hold its own hooks.
export const ToolUseStep = (props: ToolUseStepProps) => {
  const envelope =
    props.part.tool_name === DELEGATION_TOOL_NAME
      ? parseDelegationEnvelope(props.part.output)
      : undefined;
  return envelope ? (
    <DelegationStep {...props} envelope={envelope} />
  ) : (
    <PlainToolUseStep {...props} />
  );
};
