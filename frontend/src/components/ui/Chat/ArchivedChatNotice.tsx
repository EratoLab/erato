import { useState } from "react";

import { useChatContext } from "@/providers/ChatProvider";

import { Button } from "../Controls/Button";
import { UndoIcon } from "../icons";
import { runChatAction } from "./chatActionFeedback";
import { archivedNoticeText, unarchiveActionLabel } from "./chatArchiveActions";

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
  // Keyed by chat: the notice can be reused for another archived chat while a
  // restore is still under way.
  const [unarchivingChatId, setUnarchivingChatId] = useState<string | null>(
    null,
  );

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
          loading={unarchivingChatId === chatId}
          onClick={() => {
            setUnarchivingChatId(chatId);
            void runChatAction("unarchive", chatId, () =>
              unarchiveChat(chatId),
            ).finally(() =>
              setUnarchivingChatId((current) =>
                current === chatId ? null : current,
              ),
            );
          }}
          data-testid="archived-chat-unarchive"
        >
          {unarchiveActionLabel()}
        </Button>
      ) : null}
    </div>
  );
};
