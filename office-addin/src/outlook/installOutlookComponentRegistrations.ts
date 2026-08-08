import { componentRegistry } from "@erato/frontend/library";

import { AddinChatAddMenuExtraContent } from "../components/AddinChatAddMenuExtraContent";
import { OutlookEratoAppointmentRenderer } from "../components/OutlookEratoAppointmentRenderer";
import { OutlookEratoEmailRenderer } from "../components/OutlookEratoEmailRenderer";

/** Install Outlook-only registry contributions before the first chat render. */
export function installOutlookComponentRegistrations() {
  componentRegistry.ChatAddMenuExtraContent = AddinChatAddMenuExtraContent;
  componentRegistry.EratoEmailCodeBlock = OutlookEratoEmailRenderer;
  componentRegistry.EratoAppointmentCodeBlock = OutlookEratoAppointmentRenderer;
}
