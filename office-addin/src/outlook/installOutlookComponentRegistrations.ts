import {
  componentRegistry,
  registerSentWithDescriptors,
} from "@erato/frontend/library";

import { AddinChatAddMenuExtraContent } from "./components/AddinChatAddMenuExtraContent";
import { OutlookApprovalItemCard } from "./components/OutlookApprovalItemCard";
import { OutlookEratoAppointmentRenderer } from "./components/OutlookEratoAppointmentRenderer";
import { OutlookEratoEmailRenderer } from "./components/OutlookEratoEmailRenderer";
import { outlookSentWithDescriptors } from "./utils/outlookSentWith";

/** Install Outlook-only registry contributions before the first chat render. */
export function installOutlookComponentRegistrations() {
  componentRegistry.ChatAddMenuExtraContent = AddinChatAddMenuExtraContent;
  componentRegistry.EratoEmailCodeBlock = OutlookEratoEmailRenderer;
  componentRegistry.EratoAppointmentCodeBlock = OutlookEratoAppointmentRenderer;
  componentRegistry.ApprovalItemCard = OutlookApprovalItemCard;
  registerSentWithDescriptors(outlookSentWithDescriptors);
}
