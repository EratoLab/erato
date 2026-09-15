import clsx from "clsx";
import { memo } from "react";

import {
  chatAttentionStatusLabel,
  chatAttentionStatusToneClass,
} from "@/utils/chatHistoryGrouping";

import { CHAT_HISTORY_ROW_TEST_ID } from "./chatHistoryRowTestIds";

import type { ChatAttentionStatus } from "@/utils/chatHistoryGrouping";

/**
 * A bare status dot; the status text lives in the `title` here and in the
 * owning row's aria-label, so colour never carries the status alone.
 */
export const ChatAttentionStatusDot = memo<{ status: ChatAttentionStatus }>(
  ({ status }) => (
    <span
      className={clsx(
        "flex shrink-0 items-center",
        chatAttentionStatusToneClass[status],
      )}
      title={chatAttentionStatusLabel(status)}
      data-ui="chat-history-generation-status"
      data-testid={CHAT_HISTORY_ROW_TEST_ID.status}
      data-status={status}
    >
      <span
        aria-hidden="true"
        className={clsx(
          "size-2 rounded-full bg-current",
          status === "running" && "animate-pulse motion-reduce:animate-none",
        )}
      />
    </span>
  ),
);

// eslint-disable-next-line lingui/no-unlocalized-strings
ChatAttentionStatusDot.displayName = "ChatAttentionStatusDot";
