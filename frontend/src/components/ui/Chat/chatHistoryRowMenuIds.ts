/**
 * Stable keys on the row menu items the host gates. A kit maps over the item
 * array to restore its own icons or ordering without reproducing a gate; an id
 * it does not recognise keeps whatever the host gave the item.
 */
export const CHAT_HISTORY_ROW_MENU_ID = {
  pin: "pin",
  share: "share",
  rename: "rename",
  archive: "archive",
  unarchive: "unarchive",
} as const;

export type ChatHistoryRowMenuId =
  (typeof CHAT_HISTORY_ROW_MENU_ID)[keyof typeof CHAT_HISTORY_ROW_MENU_ID];
