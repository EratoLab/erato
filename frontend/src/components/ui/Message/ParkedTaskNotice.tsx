import { t } from "@lingui/core/macro";

import { Alert } from "@/components/ui/Feedback/Alert";

import { TaskChatLink } from "./TaskChatLink";

/**
 * A task of this turn that stopped where this chat is not the one asking: the
 * user stopped the turn, while it ran or with Stop at the tool-call limit (the
 * one case CT-10 leaves to the task's own chat), or the turn ended on an
 * error. The task either waits for a decision in its own chat or for one of
 * its calls to run on this device, so this says which and opens it — the
 * reverse of `OriginApprovalLink`.
 */
export const ParkedTaskNotice = ({
  childChatId,
  brief,
  reason,
}: {
  childChatId: string;
  brief?: string;
  /** The task slot's `reason`; `client_pending` waits for the device. */
  reason?: string;
}) => (
  <Alert
    type="info"
    role="status"
    geometryVariant="message"
    data-testid="parked-task-notice"
  >
    {brief && <span className="block font-medium">{brief}</span>}
    <span>
      {reason === "client_pending"
        ? t({
            id: "parkedTaskNotice.clientPending",
            message:
              "This task is waiting for one of its calls to run on this device.",
          })
        : t({
            id: "parkedTaskNotice.text",
            message: "This task is waiting for your decision in its own chat.",
          })}{" "}
    </span>
    <TaskChatLink childChatId={childChatId} testId="parked-task-open">
      {t({ id: "parkedTaskNotice.open", message: "Open the task" })}
    </TaskChatLink>
  </Alert>
);
