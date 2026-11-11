import { t } from "@lingui/core/macro";
import { useContext, useLayoutEffect, useRef, useState } from "react";

import { stopWaitingForCall } from "@/lib/clientOperations/stopWaiting";
import { ChatContext } from "@/providers/ChatProvider";

import { Button } from "../Controls/Button";

/** `ended`: the wait had already ended when the stop reached the server. */
type StopState = "stopping" | "stopped" | "ended" | "failed";

/**
 * Ends a task's wait for one call on the device (ERMAIN-1165). The call ends
 * as stopped by the user, and the task answers without its result; the item
 * that shows the wait goes once the row is read again. A wait that ended
 * meanwhile says so, reads the row again at once and asks for a sweep. The
 * row can still list it while its result is continued, so the action does
 * not come back for it.
 *
 * The state belongs to the attempt it was taken for: a task that went on to
 * wait for another call shows the action again.
 *
 * Like `SidecarReviewItem`, the button keeps focus while the stop runs, the
 * line that says the wait is over is announced politely, and focus moves to
 * the item that holds the action when the button goes away.
 */
export const StopWaitingAction = ({
  attemptId,
  focusItem,
  onWaitOver,
}: {
  attemptId: string;
  /** Moves focus to the item that holds the action. */
  focusItem?: () => void;
  /** Called with the attempt once its wait is stopped or found ended. */
  onWaitOver?: (attemptId: string) => void;
}) => {
  const refetchMessages = useContext(ChatContext)?.refetchMessages;
  const [stop, setStop] = useState<{
    attemptId: string;
    state: StopState;
  } | null>(null);
  const state = stop?.attemptId === attemptId ? stop.state : undefined;
  const isStopping = state === "stopping";
  const isOver = state === "stopped" || state === "ended";

  // The button goes once the wait is over. Focus left on the page then moves
  // to the item, never away from another element; before paint, so it is not
  // on the page for a frame first.
  const shownOver = useRef(isOver);
  useLayoutEffect(() => {
    if (shownOver.current === isOver) return;
    shownOver.current = isOver;
    const active = document.activeElement;
    if (isOver && (active === null || active === document.body)) {
      focusItem?.();
    }
  }, [isOver, focusItem]);

  const stopWaiting = async () => {
    setStop({ attemptId, state: "stopping" });
    try {
      const outcome = await stopWaitingForCall(attemptId);
      if (outcome === "settled") {
        setStop({ attemptId, state: "ended" });
        onWaitOver?.(attemptId);
        await refetchMessages?.();
        return;
      }
      setStop({ attemptId, state: "stopped" });
      onWaitOver?.(attemptId);
    } catch {
      setStop({ attemptId, state: "failed" });
    }
  };

  return (
    <div className="space-y-1">
      {!isOver && (
        <Button
          variant="secondary"
          size="sm"
          // busy and aria-disabled instead of loading, which disables: the
          // button keeps focus while the stop runs, and the missing handler
          // makes it inert.
          busy={isStopping}
          aria-disabled={isStopping || undefined}
          data-testid="stop-waiting"
          onClick={
            isStopping
              ? undefined
              : () => {
                  void stopWaiting();
                }
          }
        >
          {t({ id: "stopWaiting.action", message: "Stop waiting" })}
        </Button>
      )}
      {state === "failed" && (
        <p className="text-sm text-theme-error-fg" role="alert">
          {t({
            id: "stopWaiting.failed",
            message: "Waiting could not be stopped. Try again.",
          })}
        </p>
      )}
      {/* Live regions announce changes, so the region is on the page, empty,
          before the wait is over, and the line is a change to it. */}
      <p
        role="status"
        data-testid="stop-waiting-status"
        className={isOver ? "text-xs text-theme-fg-muted" : "sr-only"}
      >
        {state === "stopped" &&
          t({
            id: "stopWaiting.done",
            message:
              "You stopped waiting. The task answers without this result.",
          })}
        {state === "ended" &&
          t({
            id: "stopWaiting.alreadyEnded",
            message: "This wait has already ended.",
          })}
      </p>
    </div>
  );
};
