import { t } from "@lingui/core/macro";

import { useChatContext } from "@/providers/ChatProvider";

import { Button } from "../Controls/Button";
import { UndoIcon } from "../icons";
import { unarchiveActionLabel } from "./chatArchiveActions";
import { notifyUnarchiveFailed } from "./unarchiveFeedback";

export interface ArchivedChatNoticeProps {
  chatId: string;
  /** A run is archived and restored by the chat that dispatched it, so it says so and withholds the way back. */
  variant?: "chat" | "run";
}

// No retention period in the copy: the cleanup setting reaches no API.
export const archivedNoticeText = (variant: "chat" | "run" = "chat") =>
  variant === "run"
    ? t({
        id: "chat.delegatedRun.state.archived",
        message: "This run is archived and no longer takes messages.",
      })
    : t({
        id: "chat.archived.notice",
        message: "This chat is archived and no longer takes messages.",
      });

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
      <p className="min-w-0 text-theme-fg-muted">{archivedNoticeText(variant)}</p>
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
