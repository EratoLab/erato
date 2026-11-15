import { componentRegistry } from "@erato/frontend/library";

import { PowerPointChatAddMenuExtraContent } from "./components/PowerPointChatAddMenuExtraContent";

/** Install PowerPoint-only registry contributions before the first chat render. */
export function installPowerPointComponentRegistrations() {
  componentRegistry.ChatAddMenuExtraContent = PowerPointChatAddMenuExtraContent;
}
