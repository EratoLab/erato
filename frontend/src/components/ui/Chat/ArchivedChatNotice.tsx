import { useChatContext } from "@/providers/ChatProvider";

import { Button } from "../Controls/Button";
import { UndoIcon } from "../icons";
import { archivedNoticeText, unarchiveActionLabel } from "./chatArchiveActions";
import { notifyUnarchiveFailed } from "./unarchiveFeedback";

export interface ArchivedChatNoticeProps {
  chatId: string;
  /** A run is archived and restored by the chat that dispatched it, so it says so and withholds the way back. */
  variant?: "chat" | "run";
}

export const ArchivedChatNotice = ({
  chatId,
  variant = "chat",
}: ArchivedChatNoticeProps) => {
  const { unarchiveChat } = useChatContext();

  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs"
      data-testid="archived-chat-notice"
    >
      <p className="min-w-0 text-theme-fg-muted">
        {archivedNoticeText(variant)}
      </p>
      {variant === "chat" ? (
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
