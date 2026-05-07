import { t } from "@lingui/core/macro";

import { TraceStep } from "../TraceStep";
import { railIconFor } from "../icons";

import type { ReasoningSegment } from "../hooks/useReasoningSegments";
import type { BaseStepProps } from "../types";

interface ReasoningStepProps extends BaseStepProps {
  segment: ReasoningSegment;
  /** Pre-built markdown renderer from the parent. */
  renderMarkdown: (text: string) => React.ReactNode;
}

const STREAMING_CARET = "▊";

export const ReasoningStep = ({
  segment,
  status,
  isStreaming,
  isCollapsed,
  isLastStep,
  renderMarkdown,
}: ReasoningStepProps) => {
  const fallbackTitle = t`Thinking`;
  const isRunning = status === "running" && isStreaming;

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
