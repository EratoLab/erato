import { componentRegistry } from "@erato/frontend/library";

import { TeamsAttachmentsPreview } from "./components/TeamsAttachmentsPreview";
import { TeamsChatAddMenuExtraContent } from "./components/TeamsChatAddMenuExtraContent";

/** Install Teams-only registry contributions before the first chat render. */
export function installTeamsComponentRegistrations() {
  componentRegistry.ChatAddMenuExtraContent = TeamsChatAddMenuExtraContent;
  componentRegistry.ChatAttachmentsPreview = TeamsAttachmentsPreview;
}
