import { CHAT_HISTORY_ROW_MENU_ID } from "@/components/ui/Chat/chatHistoryRowMenuIds";

import { menuEntryDropdownItems } from "./dropdownItems";
import { describeRowMenu } from "../describeRowMenu";

import type { RowMenuState } from "../describeRowMenu";
import type { MenuEntry } from "../menuEntry";
import type { ChatHistoryRowMenuId } from "@/components/ui/Chat/chatHistoryRowMenuIds";
import type { DropdownMenuItem } from "@/components/ui/Controls/DropdownMenu";

type RowMenuHandlers = Partial<
  Record<ChatHistoryRowMenuId, (() => void) | undefined>
>;

const ROW_MENU_TEST_IDS: Partial<Record<ChatHistoryRowMenuId, string>> = {
  [CHAT_HISTORY_ROW_MENU_ID.archive]: "chat-history-menu-archive",
  [CHAT_HISTORY_ROW_MENU_ID.unarchive]: "chat-history-menu-unarchive",
};

export const rowMenuHandles = (
  handlers: RowMenuHandlers,
): Partial<Record<ChatHistoryRowMenuId, boolean>> =>
  Object.fromEntries(
    Object.values(CHAT_HISTORY_ROW_MENU_ID).map((id) => [
      id,
      handlers[id] !== undefined,
    ]),
  );

interface RowMenuOptions {
  pinnedChatsCount: number;
  pinnedChatsLimit: number;
  onPin?: () => void;
  onShare?: () => void;
  onEditTitle?: () => void;
  onArchive?: () => void;
  onUnarchive?: () => void;
}

/**
 * A chat row's menu, gated: its description, the web menu's items drawn
 * from it, and what a pick of each entry does, for either drawing.
 */
export function rowMenu(
  state: RowMenuState,
  { pinnedChatsCount, pinnedChatsLimit, ...actions }: RowMenuOptions,
): {
  entries: MenuEntry[];
  items: DropdownMenuItem[];
  choose: (id: string) => void;
} {
  const handlers: RowMenuHandlers = {
    [CHAT_HISTORY_ROW_MENU_ID.pin]: actions.onPin,
    [CHAT_HISTORY_ROW_MENU_ID.share]: actions.onShare,
    [CHAT_HISTORY_ROW_MENU_ID.rename]: actions.onEditTitle,
    [CHAT_HISTORY_ROW_MENU_ID.archive]: actions.onArchive,
    [CHAT_HISTORY_ROW_MENU_ID.unarchive]: actions.onUnarchive,
  };
  const entries = describeRowMenu(state, {
    pinnedChatsCount,
    pinnedChatsLimit,
    handles: rowMenuHandles(handlers),
  });
  return {
    entries,
    items: rowMenuDropdownItems(entries, handlers),
    choose: (id) => handlers[id as ChatHistoryRowMenuId]?.(),
  };
}

/** The web drawing of a row menu description, for `DropdownMenu`. */
export const rowMenuDropdownItems = (
  entries: readonly MenuEntry[],
  handlers: RowMenuHandlers,
): DropdownMenuItem[] =>
  menuEntryDropdownItems(entries, {
    onSelect: handlers,
    testIds: ROW_MENU_TEST_IDS,
  });
