/**
 * The DOM the row conformance suite probes. A kit that restyles a badge instead
 * of rendering the composed `badges` node, or writes its own harness, would
 * otherwise copy these spellings out of our test source and keep them working
 * by luck.
 *
 * Two structural rules come with them: the row element carries the `row`
 * attribute, and the row's accessible name sits on that element or on an
 * ancestor of it.
 */
export const CHAT_HISTORY_ROW_TEST_ID = {
  /** Attribute name, not a `data-testid`: it carries the chat id as its value. */
  row: "data-chat-id",
  archived: "chat-history-item-archived",
  runOrigin: "chat-history-item-run-origin",
  status: "chat-generation-status",
} as const;
