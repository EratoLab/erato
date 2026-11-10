import { t } from "@lingui/core/macro";
import { useContext, useState } from "react";

import { stopWaitingForCall } from "@/lib/clientOperations/stopWaiting";
import { ChatContext } from "@/providers/ChatProvider";

import { Button } from "../Controls/Button";

type StopState = "stopping" | "stopped" | "failed";

/**
 * Ends a task's wait for one call on the device (ERMAIN-1165). The call ends
 * as stopped by the user, and the task answers without its result; the item
 * that shows the wait goes once the row is read again. A wait that ended
 * meanwhile reads the row again at once.
 *
 * The state belongs to the attempt it was taken for: a task that went on to
 * wait for another call shows the action again.
 */
export const StopWaitingAction = ({ attemptId }: { attemptId: string }) => {
  const refetchMessages = useContext(ChatContext)?.refetchMessages;
  const [stop, setStop] = useState<{
    attemptId: string;
    state: StopState;
  } | null>(null);
  const state = stop?.attemptId === attemptId ? stop.state : undefined;

  if (state === "stopped") {
    return (
      <p
        className="text-xs text-theme-fg-muted"
        role="status"
        data-testid="stop-waiting-done"
      >
        {t({
          id: "stopWaiting.done",
          message: "You stopped waiting. The task answers without this result.",
        })}
      </p>
    );
  }

  const stopWaiting = async () => {
    setStop({ attemptId, state: "stopping" });
    try {
      const outcome = await stopWaitingForCall(attemptId);
      if (outcome === "settled") {
        setStop(null);
        await refetchMessages?.();
        return;
      }
      setStop({ attemptId, state: "stopped" });
    } catch {
      setStop({ attemptId, state: "failed" });
    }
  };

  return (
    <div className="space-y-1">
      <Button
        variant="secondary"
        size="sm"
        loading={state === "stopping"}
        data-testid="stop-waiting"
        onClick={() => {
          void stopWaiting();
        }}
      >
        {t({ id: "stopWaiting.action", message: "Stop waiting" })}
      </Button>
      {state === "failed" && (
        <p className="text-sm text-theme-error-fg" role="alert">
          {t({
            id: "stopWaiting.failed",
            message: "Waiting could not be stopped. Try again.",
          })}
        </p>
      )}
    </div>
  );
};
