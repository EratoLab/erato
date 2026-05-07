import { t } from "@lingui/core/macro";

import { TraceStep } from "../TraceStep";
import { useReasoningSplit } from "../hooks/useReasoningSummary";
import { railIconFor } from "../icons";

import type { BaseStepProps } from "../types";
import type { ContentPartReasoning } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

interface ReasoningStepProps extends BaseStepProps {
  part: ContentPartReasoning & { content_type: "reasoning" };
  /** Whether this is the last visible step (rail line should not continue). */
  isLastStep: boolean;
}

const STREAMING_CARET = "▊";

export const ReasoningStep = ({
  part,
  index,
  status,
  isStreaming,
  isCollapsed,
  isLastStep,
  renderMarkdown,
}: ReasoningStepProps) => {
  const { summary, body } = useReasoningSplit(part.text);
  const fallbackTitle = t`Thinking`;

  const isRunning = status === "running" && isStreaming;
  const displayBody =
    isRunning && body.length > 0 && !body.endsWith("\n")
      ? body + STREAMING_CARET
      : body;

  return (
    <TraceStep
      key={`reasoning-${index}`}
      railIcon={railIconFor(part.content_type, status)}
      hasTrailingRailLine={!isLastStep}
      title={summary || fallbackTitle}
      defaultOpen={isRunning}
      autoCollapse={isCollapsed}
      isActive={isRunning}
    >
      {renderMarkdown(displayBody)}
    </TraceStep>
  );
};
