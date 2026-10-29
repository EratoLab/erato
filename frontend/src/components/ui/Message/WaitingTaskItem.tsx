import { t } from "@lingui/core/macro";

import { waitingForHostLabel } from "@/lib/delegation/delegationLabels";
import {
  TASK_BRIEF_PREVIEW_CHARS,
  taskBriefFromInput,
} from "@/lib/delegation/taskBrief";

import { ComputerIcon } from "../icons";
import { TaskChatLink } from "./TaskChatLink";

import type { ApprovalItemPart } from "./approvalItems";

/**
 * One task child that waits for one of its calls to run on the device. Nothing
 * here is decided: the call runs where the host picks it up, and the response
 * goes on by itself once every such task stopped again.
 */
export const WaitingTaskItem = ({ item }: { item: ApprovalItemPart }) => {
  const child = item.child ?? undefined;
  const brief = taskBriefFromInput(item.input, TASK_BRIEF_PREVIEW_CHARS);
  return (
    <div
      data-testid="waiting-task-item"
      data-approval-id={item.approval_id}
      data-child-chat-id={child?.child_chat_id ?? ""}
      className="rounded-md border border-theme-border p-2"
    >
      <p className="text-sm font-medium text-theme-fg-primary">
        {brief ??
          t({
            id: "delegatedTaskApproval.unnamedTask",
            message: "A task this response started",
          })}
      </p>
      <p className="mt-1 flex items-center gap-1 text-xs text-theme-fg-secondary">
        <ComputerIcon className="size-4 shrink-0" />
        <span>{waitingForHostLabel(child?.waiting_for?.host_context)}</span>
      </p>
      {child && (
        <p className="mt-1 text-xs">
          <TaskChatLink
            childChatId={child.child_chat_id}
            testId="waiting-task-open"
          >
            {t({ id: "waitingTask.open", message: "Open the task" })}
          </TaskChatLink>
        </p>
      )}
    </div>
  );
};
