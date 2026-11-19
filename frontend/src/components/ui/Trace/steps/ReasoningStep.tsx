import { t } from "@lingui/core/macro";
import { memo } from "react";

import { shallowEqual } from "@/utils/chat/stableValues";

import { TraceStep } from "../TraceStep";
import { liveReasoningTail } from "../hooks/liveReasoningTail";
import { railIconFor } from "../icons";

import type { ReasoningSegment } from "../hooks/useReasoningSegments";
import type { BaseStepProps } from "../types";

interface ReasoningStepProps extends BaseStepProps {
  segment: ReasoningSegment;
  /** Pre-built markdown renderer from the parent. */
  renderMarkdown: (text: string) => React.ReactNode;
  /** When true, model-generated title and body are replaced with the masked label. */
  maskReasoningText?: boolean;
}

const STREAMING_CARET = "▊";

/** Re-renders only when its text or the renderer changes, so finished sections cost nothing per streamed chunk. */
const ReasoningBody = memo(function ReasoningBody({
  text,
  renderMarkdown,
}: {
  text: string;
  renderMarkdown: (text: string) => React.ReactNode;
}) {
  return <>{renderMarkdown(text)}</>;
});

const ReasoningStepView = ({
  segment,
  status,
  isStreaming,
  isCollapsed,
  isLastStep,
  renderMarkdown,
  maskReasoningText = false,
}: ReasoningStepProps) => {
  const fallbackTitle = t({ id: "trace.reasoning.title", message: "Thinking" });
  const isRunning = status === "running" && isStreaming;

  if (maskReasoningText) {
    if (isRunning) {
      const maskedLabel = t({
        id: "trace.reasoning.masked",
        message: "Thinking…",
      });
      return (
        <TraceStep
          railIcon={railIconFor("reasoning", status)}
          hasTrailingRailLine={!isLastStep}
          title={
            <span className="animate-pulse italic text-theme-fg-muted">
              {maskedLabel}
            </span>
          }
          defaultOpen={false}
          autoCollapse={true}
          isActive={true}
        >
          {null}
        </TraceStep>
      );
    }

    const maskedDoneLabel = t({
      id: "trace.reasoning.masked.done",
      message: "Thinking complete",
    });
    return (
      <TraceStep
        railIcon={railIconFor("reasoning", status)}
        hasTrailingRailLine={!isLastStep}
        title={
          <span className="italic text-theme-fg-muted">{maskedDoneLabel}</span>
        }
        defaultOpen={false}
        autoCollapse={true}
        isActive={false}
      >
        {null}
      </TraceStep>
    );
  }

  const bodyText = isRunning ? liveReasoningTail(segment.body) : segment.body;
  // The streaming caret only sits on the body when there IS a body to anchor
  // to. A header-only segment (body not arrived yet) just shows the title.
  const displayBody =
    isRunning && bodyText.length > 0 && !bodyText.endsWith("\n")
      ? bodyText + STREAMING_CARET
      : bodyText;

  return (
    <TraceStep
      railIcon={railIconFor("reasoning", status)}
      hasTrailingRailLine={!isLastStep}
      title={segment.title || fallbackTitle}
      defaultOpen={isRunning}
      autoCollapse={isCollapsed}
      isActive={isRunning}
      liveBody={isRunning}
    >
      <ReasoningBody text={displayBody} renderMarkdown={renderMarkdown} />
    </TraceStep>
  );
};

/** The parser hands out a new segment per chunk; comparing its text lets every finished step skip. */
export const ReasoningStep = memo(
  ReasoningStepView,
  (previous, next) =>
    shallowEqual(previous.segment, next.segment) &&
    shallowEqual({ ...previous, segment: null }, { ...next, segment: null }),
);
