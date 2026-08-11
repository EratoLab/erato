import { componentRegistry } from "@erato/frontend/library";

import { TeamsChatAddMenuExtraContent } from "./components/TeamsChatAddMenuExtraContent";

/** Install Teams-only registry contributions before the first chat render. */
export function installTeamsComponentRegistrations() {
  componentRegistry.ChatAddMenuExtraContent = TeamsChatAddMenuExtraContent;
}
