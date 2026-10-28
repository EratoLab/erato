import { componentRegistry } from "@erato/frontend/library";

import { TeamsAttachmentsPreview } from "./components/TeamsAttachmentsPreview";
import { TeamsChatAddMenuExtraContent } from "./components/TeamsChatAddMenuExtraContent";

/**
 * Install Teams-only registry contributions before the first chat render.
 * Kits are applied first, so a kit's own attachment preview is left in place.
 */
export function installTeamsComponentRegistrations() {
  componentRegistry.ChatAddMenuExtraContent = TeamsChatAddMenuExtraContent;
  componentRegistry.ChatInputAttachmentPreview ??= TeamsAttachmentsPreview;
}
