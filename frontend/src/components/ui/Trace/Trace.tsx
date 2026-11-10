import { t } from "@lingui/core/macro";
import { useState } from "react";

import {
  isDelegationToolName,
  parseDelegationEnvelope,
} from "@/lib/delegation/delegationEnvelope";
import { useTraceFeature } from "@/providers/FeatureConfigProvider";

import { TraceClusterHeader } from "./TraceClusterHeader";
import { TraceCollapse } from "./TraceCollapse";
import { TraceConnector } from "./TraceConnector";
import { TraceDoneMarker } from "./TraceDoneMarker";
import { TraceStep } from "./TraceStep";
import { TraceThinkingPlaceholder } from "./TraceThinkingPlaceholder";
import { parseReasoningSegments } from "./hooks/useReasoningSegments";
import { useThinkingGap } from "./hooks/useThinkingGap";
import { stepStatus, useIsCurrentChatBusy } from "./hooks/useTraceState";
import { railIconFor } from "./icons";
import { ReasoningStep } from "./steps/ReasoningStep";
import { ToolStatusPill } from "./steps/ToolStatusPill";
import { ToolUseStep } from "./steps/ToolUseStep";
import { isTraceablePart, type LogicalStep, type TraceablePart } from "./types";
import { approvalStopState } from "../Message/approvalItems";

import type { SidecarReviewLink } from "@/lib/desktopSidecar/sidecarReviewLinks";
import type {
  ApprovalScopeCovers,
  ContentPart,
  ToolUse,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ReactNode } from "react";

interface TraceProps {
  /** A contiguous run of reasoning, tool calls, and settled budget approvals. */
  parts: TraceablePart[];
  /**
   * Whether the parent message is still streaming. Only the last step in a
   * streaming trace is treated as the "running" writer.
   */
  isStreaming: boolean;
  /**
   * True once non-trace content (text, images) has begun after this cluster.
   * The trace stops being the active writer at that moment.
   */
  hasLaterContent: boolean;
  /** Markdown renderer reused from the parent (handles erato-file: links etc). */
  renderMarkdown: (text: string) => ReactNode;
  /**
   * Total assistant-turn duration in ms (parent message `updated_at -
   * created_at`). Used to label the cold-load summary pill. `null` when
   * unknown (e.g. mid-stream or missing `updated_at`).
   */
  durationMs?: number | null;
  /** When true, the cold-load pill flips to a "Stopped after Xs" label. */
  hasError?: boolean;
  /** Durable user decisions keyed by MCP tool-call id. */
  toolDecisions?: Record<string, ToolDecision>;
  /**
   * The call this message's turn is parked on, as its own last
   * `client_tool_pending` part names it (`waitingCallOf`), and where its
   * review in the Erato desktop app stands, if it has one.
   */
  waitingCall?: WaitingCall;
}

type WaitingCall = {
  toolCallId: string;
  /**
   * The state of the link the call's review left: `open` and `asking` wait
   * on the review, `ended` on the user asking again. None for a call that
   * waits on any other connected app.
   */
  review?: SidecarReviewLink["state"];
};

export type ToolApprovalStatus = "approved" | "denied";

/** A user's decision on one call, as its decision part records it. */
export type ToolDecision =
  | {
      status: "approved";
      alwaysAllow: boolean;
      /** Set when the call was allowed for its document or response. */
      covers?: ApprovalScopeCovers;
    }
  | {
      status: "denied";
      neverAllow: boolean;
      /** Ended because the user no longer allows the tool, not on a card. */
      withdrawn: boolean;
    };

/**
 * Vertical timeline of reasoning + tool-call steps. Renders the rail-with-line
 * pattern from the "Steps" UI: a fixed 20px icon rail plus a fluid body, with
 * an unbroken connector line between adjacent steps.
 *
 * Two modes:
 *
 * - **Streaming**: render the timeline directly with the running step as the
 *   active writer at the bottom. No header pill.
 * - **Cold load** (parent message complete): render a "Thought for X" header
 *   pill above a collapsible body. The body contains the same timeline. The
 *   trailing Done marker is dropped — the pill is the closing summary.
 */
export const Trace = ({
  parts,
  isStreaming,
  hasLaterContent,
  renderMarkdown,
  durationMs = null,
  hasError = false,
  toolDecisions = {},
  waitingCall,
}: TraceProps) => {
  const logicalSteps = flattenToLogicalSteps(parts);
  const { maskReasoningText } = useTraceFeature();
  // Hooks must run on every render path. The gap detector is internally
  // gated on streaming/hasLaterContent, so it returns false when irrelevant.
  const showThinkingPlaceholder = useThinkingGap(
    parts,
    isStreaming,
    hasLaterContent,
  );

  if (logicalSteps.length === 0) return null;

  // Mid-stream the timeline is rendered directly. Once text starts (the
  // trace is no longer the active writer), the Done marker drops in to mark
  // the trace's logical end. The cold-load pill only appears after the
  // entire message stream is complete.
  if (isStreaming) {
    const isTraceActive = !hasLaterContent;
    return (
      <TraceTimeline
        logicalSteps={logicalSteps}
        isTraceActive={isTraceActive}
        hasLaterContent={hasLaterContent}
        renderMarkdown={renderMarkdown}
        showDoneMarker={!isTraceActive}
        showThinkingPlaceholder={showThinkingPlaceholder}
        maskReasoningText={maskReasoningText}
        toolDecisions={toolDecisions}
        waitingCall={waitingCall}
      />
    );
  }

  return (
    <ColdLoadTrace
      logicalSteps={logicalSteps}
      hasLaterContent={hasLaterContent}
      renderMarkdown={renderMarkdown}
      durationMs={durationMs}
      hasError={hasError}
      maskReasoningText={maskReasoningText}
      toolDecisions={toolDecisions}
      waitingCall={waitingCall}
    />
  );
};

interface ColdLoadTraceProps {
  logicalSteps: LogicalStep[];
  hasLaterContent: boolean;
  renderMarkdown: (text: string) => ReactNode;
  durationMs: number | null;
  hasError: boolean;
  maskReasoningText: boolean;
  toolDecisions: Record<string, ToolDecision>;
  waitingCall: WaitingCall | undefined;
}

const ColdLoadTrace = ({
  logicalSteps,
  hasLaterContent,
  renderMarkdown,
  durationMs,
  hasError,
  maskReasoningText,
  toolDecisions,
  waitingCall,
}: ColdLoadTraceProps) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="my-2 min-w-0">
      <TraceClusterHeader
        durationMs={durationMs}
        hasError={hasError}
        isOpen={isOpen}
        onToggle={() => setIsOpen((prev) => !prev)}
      />
      <TraceCollapse isOpen={isOpen}>
        <TraceTimeline
          logicalSteps={logicalSteps}
          isTraceActive={false}
          hasLaterContent={hasLaterContent}
          renderMarkdown={renderMarkdown}
          showDoneMarker
          showThinkingPlaceholder={false}
          maskReasoningText={maskReasoningText}
          toolDecisions={toolDecisions}
          waitingCall={waitingCall}
        />
      </TraceCollapse>
    </div>
  );
};

interface TraceTimelineProps {
  logicalSteps: LogicalStep[];
  isTraceActive: boolean;
  hasLaterContent: boolean;
  renderMarkdown: (text: string) => ReactNode;
  /** Whether to render the Done marker at the bottom. */
  showDoneMarker: boolean;
  /**
   * Whether to render the transient "Thinking…" placeholder between the last
   * step and the Done marker. Driven by `useThinkingGap` upstream.
   */
  showThinkingPlaceholder: boolean;
  /** When true, reasoning step titles and bodies are replaced with the mask label. */
  maskReasoningText: boolean;
  toolDecisions: Record<string, ToolDecision>;
  waitingCall: WaitingCall | undefined;
}

const TraceTimeline = ({
  logicalSteps,
  isTraceActive,
  hasLaterContent,
  renderMarkdown,
  showDoneMarker: wantsDoneMarker,
  showThinkingPlaceholder,
  maskReasoningText,
  toolDecisions,
  waitingCall,
}: TraceTimelineProps) => {
  // Read here rather than threaded from the parent: both the streaming and
  // the cold-load branch render this timeline, and only the cold-load one
  // could ever show an orphan — a prop would have to cross both for one.
  const isChatBusy = useIsCurrentChatBusy();
  const statuses = logicalSteps.map((step, index) =>
    stepStatus(
      step,
      index === logicalSteps.length - 1,
      isTraceActive,
      isChatBusy,
      waitingCall?.toolCallId,
    ),
  );
  // A trace whose call the turn waits on has not ended, so it is not Done.
  const showDoneMarker = wantsDoneMarker && !statuses.includes("waiting");
  const placeholderIsLastNode = !showDoneMarker;

  return (
    <div className="min-w-0 py-1.5">
      <TraceConnector hasLine={false} />
      {logicalSteps.map((step, index) => {
        const isLastStep = index === logicalSteps.length - 1;
        // The rail line continues through whatever follows: the placeholder,
        // the Done marker, or both.
        const isLastNodeInTimeline =
          isLastStep && !showDoneMarker && !showThinkingPlaceholder;
        const status = statuses[index];
        const isCollapsed = !isLastStep || hasLaterContent;

        const stepNode = renderStep({
          step,
          status,
          isStreaming: isTraceActive,
          isCollapsed,
          isLastStep: isLastNodeInTimeline,
          renderMarkdown,
          maskReasoningText,
          toolDecisions,
          review: status === "waiting" ? waitingCall?.review : undefined,
        });

        return (
          <div key={step.key}>
            {stepNode}
            <TraceConnector hasLine={!isLastNodeInTimeline} />
          </div>
        );
      })}
      {showThinkingPlaceholder && (
        <>
          <TraceThinkingPlaceholder isLastNode={placeholderIsLastNode} />
          <TraceConnector hasLine={!placeholderIsLastNode} />
        </>
      )}
      {showDoneMarker && (
        <>
          <TraceDoneMarker />
          <TraceConnector hasLine={false} />
        </>
      )}
    </div>
  );
};

/**
 * Expand a contiguous run of trace-eligible parts into a flat list of logical
 * steps. Reasoning parts split on `**Header**\n\n` boundaries via
 * `parseReasoningSegments`; tool_use parts pass through 1:1.
 */
export const flattenToLogicalSteps = (
  parts: TraceablePart[],
): LogicalStep[] => {
  const out: LogicalStep[] = [];
  parts.forEach((part, partIndex) => {
    switch (part.content_type) {
      case "reasoning": {
        const segments = parseReasoningSegments(part.text ?? "");
        segments.forEach((segment, segmentIndex) => {
          out.push({
            kind: "reasoning",
            key: `r-${partIndex}-${segmentIndex}`,
            segment,
          });
        });
        return;
      }
      case "tool_approval_request": {
        const { resolution } = approvalStopState(
          part,
          parts.slice(partIndex + 1),
        );
        if (resolution !== null) {
          out.push({
            // eslint-disable-next-line lingui/no-unlocalized-strings -- internal step kind
            kind: "tool_budget_approval",
            key: `b-${part.tool_call_id}-${partIndex}`,
            approvalStatus: resolution,
          });
        }
        return;
      }
      case "tool_approval":
      case "tool_rejection":
        return;
      case "tool_use":
        if (!part.tool_call_id) {
          return;
        }

        out.push({
          // eslint-disable-next-line lingui/no-unlocalized-strings
          kind: "tool_use",
          key: `t-${part.tool_call_id}`,
          part: part,
        });
        return;
      default: {
        const exhaustive: never = part;
        void exhaustive;
      }
    }
  });
  return out;
};

interface RenderStepArgs {
  step: LogicalStep;
  status: ReturnType<typeof stepStatus>;
  isStreaming: boolean;
  isCollapsed: boolean;
  isLastStep: boolean;
  renderMarkdown: (text: string) => ReactNode;
  maskReasoningText: boolean;
  toolDecisions: Record<string, ToolDecision>;
  /** Where the waiting step's review in the Erato desktop app stands. */
  review: SidecarReviewLink["state"] | undefined;
}

/**
 * The decision that belongs beside this step.
 *
 * Usually the call's own id, which is what the decision part records. A
 * delegated task is the exception: the decision may have been taken on the
 * child's chat rather than on the parent's call, so the child this slot
 * dispatched is the second way in.
 */
const decisionForStep = (
  part: ToolUse & { content_type: "tool_use" },
  decisions: Record<string, ToolDecision | undefined>,
): ToolDecision | undefined => {
  // Own keys only: a call id like `constructor` must not find Object's.
  const decided = (key: string | null | undefined) =>
    typeof key === "string" && Object.hasOwn(decisions, key)
      ? decisions[key]
      : undefined;
  const byCall = decided(part.tool_call_id);
  if (byCall !== undefined || !isDelegationToolName(part.tool_name)) {
    return byCall;
  }
  return decided(parseDelegationEnvelope(part.output)?.delegateChatId);
};

const renderStep = (args: RenderStepArgs): ReactNode => {
  switch (args.step.kind) {
    case "tool_budget_approval": {
      const { approvalStatus } = args.step;
      const status = approvalStatus === "denied" ? "error" : "done";
      // eslint-disable-next-line lingui/no-unlocalized-strings -- content discriminator
      const railIcon = railIconFor("tool_approval_request", status);
      return (
        <TraceStep
          railIcon={railIcon}
          hasTrailingRailLine={!args.isLastStep}
          title={t({
            id: "trace.tool.budget_approval",
            message: "Tool-call budget",
          })}
          titleSlot={
            <ToolStatusPill status={status} approvalStatus={approvalStatus} />
          }
        />
      );
    }
    case "reasoning":
      return (
        <ReasoningStep
          segment={args.step.segment}
          status={args.status}
          isStreaming={args.isStreaming}
          isCollapsed={args.isCollapsed}
          isLastStep={args.isLastStep}
          renderMarkdown={args.renderMarkdown}
          maskReasoningText={args.maskReasoningText}
        />
      );
    case "tool_use":
      return (
        <ToolUseStep
          part={args.step.part}
          status={args.status}
          isStreaming={args.isStreaming}
          isCollapsed={args.isCollapsed}
          isLastStep={args.isLastStep}
          decision={decisionForStep(args.step.part, args.toolDecisions)}
          review={args.review}
        />
      );
    default: {
      const exhaustive: never = args.step;
      void exhaustive;
      return null;
    }
  }
};

/**
 * Group consecutive trace-eligible content parts into runs, interleaved with
 * the non-trace parts (text, images, etc.). Used by `MessageContent` to render
 * a single `<Trace>` for each cluster, with text/images flowing inline between
 * clusters as the model's narrative.
 *
 * Returns objects in source order; each is either a single `ContentPart`
 * (non-trace) or a `Trace` cluster.
 */
export type TraceCluster =
  | { kind: "trace"; parts: TraceablePart[]; startIndex: number }
  | { kind: "passthrough"; part: ContentPart; index: number };

export const groupIntoTraceClusters = (
  content: ContentPart[],
): TraceCluster[] => {
  const out: TraceCluster[] = [];
  const budgetRequestIds = new Set(
    content.flatMap((part) =>
      part.content_type === "tool_approval_request" &&
      part.kind === "tool_call_limit"
        ? [part.tool_call_id]
        : [],
    ),
  );
  let buffer: TraceablePart[] = [];
  let bufferStart = 0;

  const flush = () => {
    if (buffer.length > 0) {
      out.push({ kind: "trace", parts: buffer, startIndex: bufferStart });
      buffer = [];
    }
  };

  content.forEach((part, index) => {
    const isDecision =
      part.content_type === "tool_approval" ||
      part.content_type === "tool_rejection";
    const isBudgetDecision =
      isDecision && budgetRequestIds.has(part.tool_call_id);
    // Keep unresolved requests in the approval-card flow so their controls
    // remain visible. Once settled, the request and decision join the trace.
    const isPendingBudgetRequest =
      part.content_type === "tool_approval_request" &&
      part.kind === "tool_call_limit" &&
      approvalStopState(part, content.slice(index + 1)).resolution === null;
    if (
      (isTraceablePart(part) && !isDecision && !isPendingBudgetRequest) ||
      isBudgetDecision
    ) {
      if (buffer.length === 0) bufferStart = index;
      buffer.push(part);
      return;
    }
    flush();
    out.push({ kind: "passthrough", part, index });
  });
  flush();

  return out;
};
