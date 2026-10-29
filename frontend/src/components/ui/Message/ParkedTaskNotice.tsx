import { t } from "@lingui/core/macro";

import { Alert } from "@/components/ui/Feedback/Alert";
import { useDelegatedRunOpener } from "@/providers/DelegatedRunOpenProvider";
import { getChatUrl } from "@/utils/chat/urlUtils";

const LINK_CLASS =
  "focus-ring-tight rounded-[var(--theme-radius-base)] underline underline-offset-2 hover:text-theme-fg-primary";

/**
 * A task of this turn that stopped to ask, where this chat is not the one
 * asking: the turn was stopped, or it ended on something no task's question
 * could join. The question stays open in the task's own chat, so this says so
 * and opens it — the reverse of `OriginApprovalLink`.
 */
export const ParkedTaskNotice = ({
  childChatId,
  brief,
}: {
  childChatId: string;
  brief?: string;
}) => {
  const openRun = useDelegatedRunOpener();
  const label = t({
    id: "parkedTaskNotice.open",
    message: "Open the task",
  });
  return (
    <Alert
      type="info"
      role="status"
      geometryVariant="message"
      data-testid="parked-task-notice"
    >
      {brief && <span className="block font-medium">{brief}</span>}
      <span>
        {t({
          id: "parkedTaskNotice.text",
          message: "This task is waiting for your decision in its own chat.",
        })}{" "}
      </span>
      {openRun ? (
        <button
          type="button"
          onClick={() => openRun(childChatId)}
          className={LINK_CLASS}
          data-testid="parked-task-open"
        >
          {label}
        </button>
      ) : (
        <a
          href={getChatUrl(childChatId)}
          target="_blank"
          rel="noopener noreferrer"
          className={LINK_CLASS}
          data-testid="parked-task-open"
        >
          {label}
        </a>
      )}
    </Alert>
  );
};
