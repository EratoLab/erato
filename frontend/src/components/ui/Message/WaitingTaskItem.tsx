import { t } from "@lingui/core/macro";
import { useCallback, useLayoutEffect, useRef } from "react";

import { waitingForHostLabel } from "@/lib/delegation/delegationLabels";
import {
  TASK_BRIEF_PREVIEW_CHARS,
  taskBriefFromInput,
} from "@/lib/delegation/taskBrief";

import { ComputerIcon } from "../icons";
import { StopWaitingAction } from "./StopWaitingAction";
import { TaskChatLink } from "./TaskChatLink";

import type { ApprovalItemPart } from "./approvalItems";

/**
 * One task child that waits for one of its calls to run on the device. Nothing
 * here is decided: the call runs where the host picks it up, and the response
 * goes on by itself once every such task stopped again. The wait can be ended
 * here, and the task then answers without that call's result (ERMAIN-1165).
 *
 * Like `SidecarReviewItem`, the item is a labelled group that takes keyboard
 * focus when the button that had it goes away. When the item goes itself,
 * the row read again no longer listing the wait, focus it held moves to what
 * lists it.
 */
export const WaitingTaskItem = ({
  item,
  isArchived = false,
  onRemovedWithFocus,
}: {
  item: ApprovalItemPart;
  /** An archived chat's wait is shown, never acted on. */
  isArchived?: boolean;
  /** Takes focus the item held when it goes. */
  onRemovedWithFocus?: () => void;
}) => {
  const child = item.child ?? undefined;
  const attemptId = child?.waiting_for?.attempt_id;
  const brief = taskBriefFromInput(item.input, TASK_BRIEF_PREVIEW_CHARS);
  const title =
    brief ??
    t({
      id: "delegatedTaskApproval.unnamedTask",
      message: "A task this response started",
    });

  const itemRef = useRef<HTMLDivElement | null>(null);
  const focusItem = useCallback(() => {
    itemRef.current?.focus({ preventScroll: true });
  }, []);

  // A layout effect's cleanup runs before React takes the item off the page,
  // so whether it holds focus can still be read then.
  const removedWithFocus = useRef(onRemovedWithFocus);
  useLayoutEffect(() => {
    removedWithFocus.current = onRemovedWithFocus;
  }, [onRemovedWithFocus]);
  useLayoutEffect(() => {
    const node = itemRef.current;
    return () => {
      if (node?.contains(document.activeElement)) removedWithFocus.current?.();
    };
  }, []);

  return (
    <div
      ref={itemRef}
      tabIndex={-1}
      role="group"
      aria-label={title}
      data-testid="waiting-task-item"
      data-approval-id={item.approval_id}
      data-child-chat-id={child?.child_chat_id ?? ""}
      className="focus-ring rounded-md border border-theme-border p-2"
    >
      <p className="text-sm font-medium text-theme-fg-primary">{title}</p>
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
      {attemptId && !isArchived && (
        <div className="mt-2">
          <StopWaitingAction attemptId={attemptId} focusItem={focusItem} />
        </div>
      )}
    </div>
  );
};
