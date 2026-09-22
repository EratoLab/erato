import { createNeutralAddinSessionController } from "../core/AddinChatProviderCore";

/**
 * History is shared server-side but the selection is not: opening a document
 * must never move the chat an Outlook task pane or a Teams tab has open.
 * Follows the `erato.addin.<host>.*` convention (see ARCHITECTURE.md).
 */
export const WORD_CURRENT_CHAT_KEY = "erato.addin.word.currentChat.v1";

export const WordAddinSessionController = createNeutralAddinSessionController(
  WORD_CURRENT_CHAT_KEY,
);
