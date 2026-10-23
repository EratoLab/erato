import { componentRegistry } from "@erato/frontend/library";

import { TeamsChatAddMenuExtraContent } from "./components/TeamsChatAddMenuExtraContent";

/**
 * Install Teams-only registry contributions before the first chat render.
 * Transcripts are context chips, so a kit's attachment preview renders the
 * Teams tab's other files as it does everywhere else.
 */
export function installTeamsComponentRegistrations() {
  componentRegistry.ChatAddMenuExtraContent = TeamsChatAddMenuExtraContent;
}
