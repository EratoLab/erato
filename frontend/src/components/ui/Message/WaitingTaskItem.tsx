import { t } from "@lingui/core/macro";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

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
import { StopWaitingAction } from "./StopWaitingAction";
import { TaskChatLink } from "./TaskChatLink";

import type { ApprovalItemPart } from "./approvalItems";

/**
 * One task child that waits for one of its calls to run on the device. Nothing
 * here is decided: the call runs where the host picks it up, and the response
 * goes on by itself once every such task stopped again. The wait can be ended
 * here, and the task then answers without that call's result (ERMAIN-1165);
 * the item then no longer says what it waits for.
 *
 * Like `SidecarReviewItem`, the item is a labelled group that takes keyboard
 * focus when the button that had it goes away. When the item goes itself,
 * the row read again no longer listing the wait, focus it held moves to what
 * lists it.
 *
 * While that call waits for its review in the Erato desktop app, or once the
 * review ended, the item shows the review as the task's own chat does, so the
 * response's slot holds it too. The review link is keyed by the task's row and
 * call, and the item carries both.
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
  const reviewKey = child
    ? reviewLinkKey(child.child_message_id, child.child_tool_call_id)
    : undefined;
  const link = useSidecarReviewLinks((state) =>
    reviewKey ? state.links[reviewKey] : undefined,
  );
  // Asking again starts no review of its own: until one opens, the call waits.
  const review =
    link?.state === "open" || link?.state === "ended" ? link : undefined;

  const title =
    brief ??
    t({
      id: "delegatedTaskApproval.unnamedTask",
      message: "A task this response started",
    });

  // The attempt whose wait was stopped or found ended. The row keeps listing
  // it until the task answered, but it no longer waits for the host.
  const [overAttemptId, setOverAttemptId] = useState<string>();
  const waitOver = attemptId !== undefined && overAttemptId === attemptId;

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
      {waitOver ? null : reviewKey && review ? (
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
      {attemptId && !isArchived && (
        <div className="mt-2">
          <StopWaitingAction
            attemptId={attemptId}
            focusItem={focusItem}
            onWaitOver={setOverAttemptId}
          />
        </div>
      )}
    </div>
  );
};
