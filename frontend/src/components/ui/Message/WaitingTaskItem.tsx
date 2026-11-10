import { t } from "@lingui/core/macro";

import { waitingForHostLabel } from "@/lib/delegation/delegationLabels";
import {
  TASK_BRIEF_PREVIEW_CHARS,
  taskBriefFromInput,
} from "@/lib/delegation/taskBrief";
import {
  reviewLinkKey,
  useSidecarReviewLinks,
} from "@/lib/desktopSidecar/sidecarReviewLinks";

import { ComputerIcon } from "../icons";
import { SidecarReviewItem } from "./SidecarReviewItem";
import { TaskChatLink } from "./TaskChatLink";

import type { ApprovalItemPart } from "./approvalItems";

/**
 * One task child that waits for one of its calls to run on the device. Nothing
 * here is decided: the call runs where the host picks it up, and the response
 * goes on by itself once every such task stopped again.
 *
 * While that call waits for its review in the Erato desktop app, or once the
 * review ended, the item shows the review as the task's own chat does, so the
 * response's slot holds it too. The review link is keyed by the task's row and
 * call, and the item carries both.
 */
export const WaitingTaskItem = ({ item }: { item: ApprovalItemPart }) => {
  const child = item.child ?? undefined;
  const brief = taskBriefFromInput(item.input, TASK_BRIEF_PREVIEW_CHARS);
  const reviewKey = child
    ? reviewLinkKey(child.child_message_id, child.child_tool_call_id)
    : undefined;
  const link = useSidecarReviewLinks((state) =>
    reviewKey ? state.links[reviewKey] : undefined,
  );
  // Asking again starts no review of its own: until one opens, the call waits.
  const review =
    link?.state === "open" || link?.state === "ended" ? link : undefined;
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
      {reviewKey && review ? (
        <SidecarReviewItem
          linkKey={reviewKey}
          link={review}
          toolName={child?.tool_name}
          inTaskItem
        />
      ) : (
        <p className="mt-1 flex items-center gap-1 text-xs text-theme-fg-secondary">
          <ComputerIcon className="size-4 shrink-0" />
          <span>{waitingForHostLabel(child?.waiting_for?.host_context)}</span>
        </p>
      )}
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
