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
}

/**
 * Vertical timeline of reasoning + tool-call steps. Renders the rail-with-line
 * pattern from the "Steps" UI: a fixed 20px icon rail plus a fluid body, with
 * an unbroken connector line between adjacent steps.
 *
 * Reasoning parts may expand into multiple `**Header**`-bounded segments —
 * each rendered as its own step. Tool calls are always 1:1.
 */
export const Trace = ({
  parts,
  isStreaming,
  hasLaterContent,
  renderMarkdown,
}: TraceProps) => {
  const logicalSteps = flattenToLogicalSteps(parts);
  if (logicalSteps.length === 0) return null;

  // The trace cluster is the "active writer" only while the parent is still
  // streaming AND no later content (text/images) has begun. Once text starts,
  // the trace is done — even if the parent stream itself is still going.
  const isTraceActive = isStreaming && !hasLaterContent;
  const showDoneMarker = !isTraceActive;

  return (
    <div className="min-w-0 py-1.5">
      <TraceConnector hasLine={false} />
      {logicalSteps.map((step, index) => {
        const isLastStep = index === logicalSteps.length - 1;
        // The rail line continues to the Done marker when one is rendered.
        const isLastNodeInTimeline = isLastStep && !showDoneMarker;
        const status = stepStatus(step, isLastStep, isTraceActive);
        // Earlier steps collapse once a later step (or non-trace content)
        // begins. The active writer stays open.
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
