import { useState } from "react";

import { TraceClusterHeader } from "./TraceClusterHeader";
import { TraceCollapse } from "./TraceCollapse";
import { TraceConnector } from "./TraceConnector";
import { TraceDoneMarker } from "./TraceDoneMarker";
import { parseReasoningSegments } from "./hooks/useReasoningSegments";
import { stepStatus } from "./hooks/useTraceState";
import { ReasoningStep } from "./steps/ReasoningStep";
import { ToolUseStep } from "./steps/ToolUseStep";
import { isTraceablePart, type LogicalStep, type TraceablePart } from "./types";

import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ReactNode } from "react";

interface TraceProps {
  /** A contiguous run of trace-eligible parts (reasoning, tool_use). */
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
}

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
}: TraceProps) => {
  const logicalSteps = flattenToLogicalSteps(parts);
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
    />
  );
};

interface ColdLoadTraceProps {
  logicalSteps: LogicalStep[];
  hasLaterContent: boolean;
  renderMarkdown: (text: string) => ReactNode;
  durationMs: number | null;
  hasError: boolean;
}

const ColdLoadTrace = ({
  logicalSteps,
  hasLaterContent,
  renderMarkdown,
  durationMs,
  hasError,
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
          showDoneMarker={false}
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
  /** Whether to render the Done marker at the bottom (streaming only today). */
  showDoneMarker: boolean;
}

const TraceTimeline = ({
  logicalSteps,
  isTraceActive,
  hasLaterContent,
  renderMarkdown,
  showDoneMarker,
}: TraceTimelineProps) => (
  <div className="min-w-0 py-1.5">
    <TraceConnector hasLine={false} />
    {logicalSteps.map((step, index) => {
      const isLastStep = index === logicalSteps.length - 1;
      const isLastNodeInTimeline = isLastStep && !showDoneMarker;
      const status = stepStatus(step, isLastStep, isTraceActive);
      const isCollapsed = !isLastStep || hasLaterContent;

      const stepNode = renderStep({
        step,
        status,
        isStreaming: isTraceActive,
        isCollapsed,
        isLastStep: isLastNodeInTimeline,
        renderMarkdown,
      });

      return (
        <div key={step.key}>
          {stepNode}
          <TraceConnector hasLine={!isLastNodeInTimeline} />
        </div>
      );
    })}
    {showDoneMarker && (
      <>
        <TraceDoneMarker />
        <TraceConnector hasLine={false} />
      </>
    )}
  </div>
);

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
        const segments = parseReasoningSegments(part.text);
        segments.forEach((segment, segmentIndex) => {
          out.push({
            kind: "reasoning",
            key: `r-${partIndex}-${segmentIndex}`,
            segment,
          });
        });
        return;
      }
      case "tool_use":
        out.push({
          // eslint-disable-next-line lingui/no-unlocalized-strings
          kind: "tool_use",
          key: `t-${part.tool_call_id}`,
          part,
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
}

const renderStep = (args: RenderStepArgs): ReactNode => {
  switch (args.step.kind) {
    case "reasoning":
      return (
        <ReasoningStep
          segment={args.step.segment}
          status={args.status}
          isStreaming={args.isStreaming}
          isCollapsed={args.isCollapsed}
          isLastStep={args.isLastStep}
          renderMarkdown={args.renderMarkdown}
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
  let buffer: TraceablePart[] = [];
  let bufferStart = 0;

  const flush = () => {
    if (buffer.length > 0) {
      out.push({ kind: "trace", parts: buffer, startIndex: bufferStart });
      buffer = [];
    }
  };

  content.forEach((part, index) => {
    if (isTraceablePart(part)) {
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
