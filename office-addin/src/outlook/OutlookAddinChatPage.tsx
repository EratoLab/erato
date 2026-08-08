import {
  FileCapabilitiesProvider,
  ProfileProvider,
} from "@erato/frontend/library";

import { OutlookAddinChat } from "./OutlookAddinChat";
import { AddinChatProvider } from "../providers/AddinChatProvider";

export function OutlookAddinChatPage() {
  return (
    <ProfileProvider>
      <FileCapabilitiesProvider>
        <AddinChatProvider>
          <OutlookAddinChat />
        </AddinChatProvider>
      </FileCapabilitiesProvider>
    </ProfileProvider>
  );
}
