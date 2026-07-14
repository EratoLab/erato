import { t } from "@lingui/core/macro";

import { TraceStep } from "../TraceStep";
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

export const ReasoningStep = ({
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

  // The streaming caret only sits on the body when there IS a body to anchor
  // to. A header-only segment (body not arrived yet) just shows the title.
  const displayBody =
    isRunning && segment.body.length > 0 && !segment.body.endsWith("\n")
      ? segment.body + STREAMING_CARET
      : segment.body;

  return (
    <TraceStep
      railIcon={railIconFor("reasoning", status)}
      hasTrailingRailLine={!isLastStep}
      title={segment.title || fallbackTitle}
      defaultOpen={isRunning}
      autoCollapse={isCollapsed}
      isActive={isRunning}
    >
      {renderMarkdown(displayBody)}
    </TraceStep>
  );
};
