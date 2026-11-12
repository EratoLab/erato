import { createNeutralAddinSessionController } from "../core/AddinChatProviderCore";

export const POWERPOINT_CURRENT_CHAT_KEY =
  "erato.addin.powerpoint.currentChat.v1";

export const PowerPointAddinSessionController =
  createNeutralAddinSessionController(POWERPOINT_CURRENT_CHAT_KEY);
