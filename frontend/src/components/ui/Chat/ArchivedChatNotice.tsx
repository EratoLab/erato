import { t } from "@lingui/core/macro";

import { useChatContext } from "@/providers/ChatProvider";

import { Button } from "../Controls/Button";
import { UndoIcon } from "../icons";
import { unarchiveActionLabel } from "./chatArchiveActions";
import { notifyUnarchiveFailed } from "./unarchiveFeedback";

export interface ArchivedChatNoticeProps {
  chatId: string;
  /** Delegated runs say they are archived but withhold the way back, as their rows do. */
  canUnarchive?: boolean;
}

/**
 * No retention period in the copy: how long an archived chat survives is a
 * worker-side setting that reaches no API, so any number would be invented.
 */
export const ArchivedChatNotice = ({
  chatId,
  canUnarchive = true,
}: ArchivedChatNoticeProps) => {
  const { unarchiveChat } = useChatContext();

  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs"
      data-testid="archived-chat-notice"
    >
      <p className="min-w-0 text-theme-fg-muted">
        {t({
          id: "chat.archived.notice",
          message: "This chat is archived and no longer takes messages.",
        })}
      </p>
      {canUnarchive ? (
        <Button
          type="button"
          variant="secondary"
          icon={<UndoIcon className="size-4" />}
          onClick={() => {
            void unarchiveChat(chatId).catch(notifyUnarchiveFailed);
          }}
          data-testid="archived-chat-unarchive"
        >
          {unarchiveActionLabel()}
        </Button>
      ) : null}
    </div>
  );
};
