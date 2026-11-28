import { CHAT_HISTORY_ROW_MENU_ID } from "@/components/ui/Chat/chatHistoryRowMenuIds";

import { menuEntryDropdownItems } from "./dropdownItems";

import type { MenuEntry } from "../menuEntry";
import type { ChatHistoryRowMenuId } from "@/components/ui/Chat/chatHistoryRowMenuIds";
import type { DropdownMenuItem } from "@/components/ui/Controls/DropdownMenu";

export type RowMenuHandlers = Partial<
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

/** The web drawing of a row menu description, for `DropdownMenu`. */
export const rowMenuDropdownItems = (
  entries: readonly MenuEntry[],
  handlers: RowMenuHandlers,
): DropdownMenuItem[] =>
  menuEntryDropdownItems(entries, {
    onSelect: handlers,
    testIds: ROW_MENU_TEST_IDS,
  });
