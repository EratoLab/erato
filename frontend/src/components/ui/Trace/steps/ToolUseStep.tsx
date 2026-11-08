import { t } from "@lingui/core/macro";

import { ToolCallInput, ToolCallOutput } from "@/components/ui/ToolCall";
import {
  isDelegationToolName,
  parseDelegationEnvelope,
} from "@/lib/delegation/delegationEnvelope";
import { useSidecarLocalTrace } from "@/lib/desktopSidecar/localTraceStore";

import { SidecarLocalTraceSubtree } from "../SidecarLocalTraceSubtree";
import { TraceStep } from "../TraceStep";
import { railIconFor } from "../icons";
import { DelegationStep } from "./DelegationStep";
import { refusedWithoutDecision, ToolDecisionRow } from "./ToolDecisionRow";
import { ToolStatusPill } from "./ToolStatusPill";

import type { ToolDecision } from "../Trace";
import type { BaseStepProps } from "../types";
import type { ToolUse } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

interface ToolUseStepProps extends BaseStepProps {
  part: ToolUse & { content_type: "tool_use" };
  decision?: ToolDecision;
}

// The server's cap; rows and events from other writers get it here.
const MAX_PROGRESS_CHARS = 200;

const progressText = (message: unknown): string | undefined => {
  if (typeof message !== "string") return undefined;
  const text = Array.from(message.slice(0, MAX_PROGRESS_CHARS * 2))
    .slice(0, MAX_PROGRESS_CHARS)
    .join("")
    .trim();
  return text.length > 0 ? text : undefined;
};

const PlainToolUseStep = ({
  part,
  status,
  isStreaming,
  isCollapsed,
  isLastStep,
  decision,
}: ToolUseStepProps) => {
  const resolvedStatus = part.status;
  const isRunning = status === "running" && isStreaming;
  const toolName = part.tool_name ?? "";
  const toolCallId = part.tool_call_id;
  const progress = progressText(part.progress_message);

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
      <ToolDecisionRow part={part} decision={decision} />
      <TraceStep
        railIcon={railIconFor(part.content_type, status)}
        hasTrailingRailLine={!isLastStep}
        title={
          <>
            {toolName}
            {part.display?.server_name && (
              <span
                dir="auto"
                className="pl-2 font-normal text-theme-fg-muted [unicode-bidi:isolate]"
              >
                {part.display.server_name}
              </span>
            )}
            {progress && (
              <span
                dir="auto"
                className="pl-2 font-normal text-theme-fg-muted [unicode-bidi:isolate]"
                title={progress}
              >
                {progress}
              </span>
            )}
          </>
        }
        titleSlot={
          // A denied or refused call never ran: its decision row says so.
          decision?.status === "denied" ||
          refusedWithoutDecision(part, decision) ? undefined : (
            <ToolStatusPill
              status={status}
              label={
                part.status === "preparing" && status !== "interrupted"
                  ? t({ id: "trace.tool.preparing", message: "Preparing" })
                  : undefined
              }
            />
          )
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
  const envelope = isDelegationToolName(props.part.tool_name)
    ? parseDelegationEnvelope(props.part.output)
    : undefined;
  return envelope ? (
    <DelegationStep {...props} envelope={envelope} />
  ) : (
    <PlainToolUseStep {...props} />
  );
};
