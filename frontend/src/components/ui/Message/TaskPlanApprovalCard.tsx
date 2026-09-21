import { plural, t } from "@lingui/core/macro";

import { ToolCallInput } from "@/components/ui/ToolCall";
import {
  TASK_BRIEF_PREVIEW_CHARS,
  taskBriefFromInput,
} from "@/lib/delegation/taskBrief";

import { ActionConfirmationCard } from "./ActionConfirmationCard";
import {
  APPROVAL_CARD_SHELL_CLASS,
  ApprovalBulkActions,
  stagedItemPresentation,
} from "./ApprovalDecisionActions";

import type { ApprovalItemPart, StagedDecisions } from "./approvalItems";
import type { ToolApprovalDecision } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * How the task would run, when the model asked for something other than the
 * default. An async task answers later, into this chat but not into this turn,
 * which is the part of the plan a user is most likely to want to stop.
 */
const runModeLabel = (input: unknown): string | undefined => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return undefined;
  }
  const runMode = (input as Record<string, unknown>).run_mode;
  if (runMode !== "async") {
    return undefined;
  }
  return t({
    id: "taskPlanApproval.runMode.async",
    message: "Answers separately, after this reply",
  });
};

/**
 * One planned task: the brief, how it would run, and the arguments in full.
 *
 * Nothing has been dispatched yet — that is what asking before dispatch bought
 * — so there is no child to name and no run to open.
 */
const PlannedTaskItem = ({
  item,
  position,
  staged,
  isArchived,
  isBusy,
  onDecide,
}: {
  item: ApprovalItemPart;
  /** The first row is the one that scrolls the card into view. */
  position: number;
  staged: ToolApprovalDecision | undefined;
  isArchived: boolean;
  isBusy: boolean;
  onDecide: (decision: ToolApprovalDecision) => void;
}) => {
  const brief = taskBriefFromInput(item.input, TASK_BRIEF_PREVIEW_CHARS);
  const runMode = runModeLabel(item.input);
  const { status, resolvedLabel } = stagedItemPresentation(staged, isArchived);

  return (
    <div
      data-testid="task-plan-approval-item"
      data-approval-id={item.approval_id}
      className="rounded-md border border-theme-border p-2"
    >
      <p className="text-sm font-medium text-theme-fg-primary">
        {brief ??
          t({
            id: "taskPlanApproval.unnamedTask",
            message: `Task ${position}`,
          })}
      </p>
      {runMode !== undefined && (
        <p className="text-xs text-theme-fg-muted">{runMode}</p>
      )}
      <div className="mt-2 max-h-48 overflow-y-auto">
        <ToolCallInput input={item.input} />
      </div>
      <ActionConfirmationCard
        title={t({
          id: "taskPlanApproval.itemTitle",
          message: "Run this task?",
        })}
        onAllowOnce={() => onDecide("approve")}
        onDeny={() => onDecide("reject")}
        status={status}
        resolvedLabel={resolvedLabel}
        isBusy={isBusy}
        scrollIntoViewOnMount={position === 1}
        data-testid="task-plan-approval-item-card"
      />
    </div>
  );
};

/**
 * The plan a model wants to dispatch, decided task by task.
 *
 * Deliberately without any standing answer: what a deployment is willing to
 * dispatch unasked is `[delegation.tasks.approval]`'s to say, not a per-user
 * setting's. A declined task is refused to the model and the rest of the turn
 * runs, so approving part of a plan is a first-class outcome rather than an
 * all-or-nothing gate.
 */
export const TaskPlanApprovalCard = ({
  items,
  staged,
  isArchived,
  isBusy,
  onDecideItem,
  onDecideAll,
}: {
  items: ApprovalItemPart[];
  staged: StagedDecisions;
  isArchived: boolean;
  isBusy: boolean;
  onDecideItem: (approvalId: string, decision: ToolApprovalDecision) => void;
  onDecideAll: (decision: ToolApprovalDecision) => void;
}) => {
  const itemCount = items.length;
  return (
    <div
      data-testid="task-plan-approval"
      data-approval-kind="task_plan"
      data-item-count={itemCount}
      className={`${APPROVAL_CARD_SHELL_CLASS} space-y-2`}
    >
      <div>
        <p className="text-sm font-medium text-theme-fg-primary">
          {t({
            id: "taskPlanApproval.title",
            message: plural(itemCount, {
              one: "Run this task?",
              other: "Run these tasks?",
            }),
          })}
        </p>
        <p className="text-sm text-theme-fg-secondary">
          {t({
            id: "taskPlanApproval.description",
            message: plural(itemCount, {
              one: "The assistant planned this sub-task. Declining it is refused to the assistant and the response continues without it.",
              other:
                "The assistant planned these sub-tasks. Decide each one; the ones you decline are refused and the response continues without them.",
            }),
          })}
        </p>
      </div>
      {items.map((item, index) => (
        <PlannedTaskItem
          key={item.approval_id}
          item={item}
          position={index + 1}
          staged={staged[item.approval_id]}
          isArchived={isArchived}
          isBusy={isBusy}
          onDecide={(decision) => onDecideItem(item.approval_id, decision)}
        />
      ))}
      {!isArchived && (
        <ApprovalBulkActions
          itemCount={itemCount}
          onDecideAll={onDecideAll}
          isBusy={isBusy}
          testId="task-plan-approval-bulk"
        />
      )}
    </div>
  );
};
