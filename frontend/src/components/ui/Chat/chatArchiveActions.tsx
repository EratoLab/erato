import { t } from "@lingui/core/macro";

import {
  describeArchiveEntries,
  unarchiveActionLabel as describedUnarchiveLabel,
} from "@/lib/shell/menus/describeRowMenu";
import {
  rowMenuDropdownItems,
  rowMenuHandles,
} from "@/lib/shell/menus/web/rowMenuDropdownItems";

import { CHAT_HISTORY_ROW_MENU_ID } from "./chatHistoryRowMenuIds";
import { CHAT_HISTORY_ROW_TEST_ID } from "./chatHistoryRowTestIds";

import type { DropdownMenuItem } from "../Controls/DropdownMenu";
import type { ChatAttentionStatus } from "@/utils/chatHistoryGrouping";

export const archivedChatLabel = () =>
  t({ id: "chat.history.item.archived", message: "Archived" });

export const unarchiveActionLabel = (): string => describedUnarchiveLabel();

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

export const ArchivedChatPill = ({ label }: { label: string }) => (
  <span
    className="pill-geometry inline-flex shrink-0 items-center border border-theme-border bg-theme-bg-secondary px-2 py-0.5 text-xs font-medium text-theme-fg-muted"
    data-testid={CHAT_HISTORY_ROW_TEST_ID.archived}
  >
    {label}
  </span>
);

/**
 * The archive/unarchive pair, shared so the sidebar list and the search page
 * cannot drift apart on labels, test ids or the confirm rule.
 */
export const buildArchiveMenuItems = ({
  archived,
  status,
  waitingOnly = false,
  onArchive,
  onUnarchive,
}: {
  archived: boolean;
  status: ChatAttentionStatus | null;
  /** The chat is parked, waiting for an app or its tasks, which shows no status. */
  waitingOnly?: boolean;
  onArchive?: () => void;
  onUnarchive?: () => void;
}): DropdownMenuItem[] => {
  // Gated on the handler like every other item: a caller that forgets to
  // forward one would otherwise ship a visible, clickable, inert action.
  const handlers = {
    [CHAT_HISTORY_ROW_MENU_ID.archive]: onArchive,
    [CHAT_HISTORY_ROW_MENU_ID.unarchive]: onUnarchive,
  };
  return rowMenuDropdownItems(
    describeArchiveEntries({
      archived,
      status,
      waitingOnly,
      handles: rowMenuHandles(handlers),
    }),
    handlers,
  );
};
