import { createNeutralAddinSessionController } from "../core/AddinChatProviderCore";

export const EXCEL_CURRENT_CHAT_KEY = "erato.addin.excel.currentChat.v1";

export const ExcelAddinSessionController = createNeutralAddinSessionController(
  EXCEL_CURRENT_CHAT_KEY,
);
