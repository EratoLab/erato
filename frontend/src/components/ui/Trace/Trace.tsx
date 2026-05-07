import { TraceConnector } from "./TraceConnector";
import { TraceDoneMarker } from "./TraceDoneMarker";
import { stepStatus } from "./hooks/useTraceState";
import { ReasoningStep } from "./steps/ReasoningStep";
import { ToolUseStep } from "./steps/ToolUseStep";
import { isTraceablePart, type TraceablePart } from "./types";

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
   * When true, render the deltas with a streaming caret in the running step.
   * Set to false for cold-loaded historical messages.
   */
  hasLaterContent: boolean;
  /** Markdown renderer reused from the parent (handles erato-file: links etc). */
  renderMarkdown: (text: string) => ReactNode;
}

/**
 * Vertical timeline of reasoning + tool-call steps. Renders the rail-with-line
 * pattern from Anthropic's "Steps" UI: a fixed 20px icon rail plus a fluid
 * body, with an unbroken connector line between adjacent steps.
 *
 * Discriminates per `content_type` and dispatches to the matching step
 * component. Adding a new traceable variant is a compile error here until the
 * `default` branch is updated — see `TraceablePart` in `./types`.
 */
export const Trace = ({
  parts,
  isStreaming,
  hasLaterContent,
  renderMarkdown,
}: TraceProps) => {
  if (parts.length === 0) return null;

  // The trace cluster is the "active writer" only while the parent is still
  // streaming AND no later content (text/images) has begun. Once text starts,
  // the trace is done — even if the parent stream itself is still going.
  const isTraceActive = isStreaming && !hasLaterContent;
  const showDoneMarker = !isTraceActive;

  return (
    <div className="min-w-0 py-1.5">
      <TraceConnector hasLine={false} />
      {parts.map((part, index) => {
        const isLastTracePart = index === parts.length - 1;
        // The rail line continues to the Done marker when one is rendered.
        const isLastNodeInTimeline = isLastTracePart && !showDoneMarker;
        const status = stepStatus(part, isLastTracePart, isTraceActive);
        // Earlier steps collapse once a later step (or non-trace content)
        // begins. The active writer stays open.
        const isCollapsed = !isLastTracePart || hasLaterContent;

        const stepNode = renderStep({
          part,
          index,
          status,
          isStreaming: isTraceActive,
          isCollapsed,
          isLastStep: isLastNodeInTimeline,
          renderMarkdown,
        });

        return (
          <div key={`step-${index}`}>
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

interface RenderStepArgs {
  part: TraceablePart;
  index: number;
  status: ReturnType<typeof stepStatus>;
  isStreaming: boolean;
  isCollapsed: boolean;
  isLastStep: boolean;
  renderMarkdown: (text: string) => ReactNode;
}

const renderStep = (args: RenderStepArgs): ReactNode => {
  const { part } = args;
  switch (part.content_type) {
    case "reasoning":
      return (
        <ReasoningStep
          part={part}
          index={args.index}
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
          part={part}
          index={args.index}
          status={args.status}
          isStreaming={args.isStreaming}
          isCollapsed={args.isCollapsed}
          isLastStep={args.isLastStep}
          renderMarkdown={args.renderMarkdown}
        />
      );
    default: {
      const exhaustive: never = part;
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
