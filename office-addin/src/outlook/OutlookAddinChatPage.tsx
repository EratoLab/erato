import {
  FileCapabilitiesProvider,
  ProfileProvider,
} from "@erato/frontend/library";

import { OutlookAddinChat } from "./OutlookAddinChat";
import { OutlookAddinSessionController } from "./OutlookAddinSessionController";
import { OutlookStartViewSwitcher } from "./OutlookStartViewSwitcher";
import { AddinChatProviderCore } from "../core/AddinChatProviderCore";

/** Outlook composition of generic chat data with Outlook session policy. */
export function OutlookAddinChatPage() {
  return (
    <ProfileProvider>
      <FileCapabilitiesProvider>
        <AddinChatProviderCore
          platform="outlook"
          SessionController={OutlookAddinSessionController}
        >
          <OutlookStartViewSwitcher platform="outlook">
            <OutlookAddinChat />
          </OutlookStartViewSwitcher>
        </AddinChatProviderCore>
      </FileCapabilitiesProvider>
    </ProfileProvider>
  );
}
