import { t } from "@lingui/core/macro";

import { ActionConfirmationCard } from "./ActionConfirmationCard";

import type { ActionConfirmationStatus } from "./ActionConfirmationCard";
import type { ToolApprovalDecision } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * The tool-call limit's choice: continue with twice the budget (`approve`),
 * answer with what was collected so far (`reject`), or stop the response
 * (`withdraw`). When tasks of the response ask on the same stop, their
 * questions follow this one, and Stop sends each back to its task's own chat,
 * as stopping the response does.
 */
export const ToolCallLimitItem = ({
  tasksAsk = false,
  status,
  resolvedLabel,
  isBusy,
  scrollIntoViewOnMount,
  onDecide,
}: {
  /** Tasks of the response also ask on this stop. */
  tasksAsk?: boolean;
  status: ActionConfirmationStatus;
  resolvedLabel: string | undefined;
  isBusy: boolean;
  scrollIntoViewOnMount: boolean;
  onDecide: (decision: ToolApprovalDecision) => void;
}) => {
  const choice = t({
    id: "toolCallLimit.description",
    message:
      "Continue with twice the tool-call budget, generate an answer using the information collected so far, or stop this response.",
  });
  return (
    <ActionConfirmationCard
      title={t({
        id: "toolCallLimit.title",
        message: "Tool-call limit reached",
      })}
      description={
        tasksAsk
          ? `${choice} ${t({
              id: "toolCallLimit.tasksAsk",
              message:
                "Your tasks' questions come next. If you stop, each task waits for your decision in its own chat.",
            })}`
          : choice
      }
      allowOnceLabel={t({
        id: "toolCallLimit.continue",
        message: "Continue tool calls",
      })}
      alwaysAllowLabel={t({
        id: "toolCallLimit.answer",
        message: "Generate answer now",
      })}
      denyLabel={t({ id: "toolCallLimit.stop", message: "Stop" })}
      onAllowOnce={() => onDecide("approve")}
      onAlwaysAllow={() => onDecide("reject")}
      onDeny={() => onDecide("withdraw")}
      status={status}
      resolvedLabel={resolvedLabel}
      isBusy={isBusy}
      scrollIntoViewOnMount={scrollIntoViewOnMount}
      data-testid="tool-call-limit-card"
    />
  );
};
