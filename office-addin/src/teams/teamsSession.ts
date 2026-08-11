import { createNeutralAddinSessionController } from "../core/AddinChatProviderCore";

/**
 * History is shared server-side but the selection is not: opening the tab must
 * never move the chat an Outlook task pane has open.
 */
export const TEAMS_CURRENT_CHAT_KEY = "erato.addin.teams.currentChat.v1";

export const TeamsAddinSessionController = createNeutralAddinSessionController(
  TEAMS_CURRENT_CHAT_KEY,
);
