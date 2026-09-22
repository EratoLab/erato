import { createNeutralAddinSessionController } from "../core/AddinChatProviderCore";

/** Keep host selections independent even though chat history is shared. */
export const WORD_CURRENT_CHAT_KEY = "erato.addin.word.currentChat.v1";

export const WordAddinSessionController = createNeutralAddinSessionController(
  WORD_CURRENT_CHAT_KEY,
);
