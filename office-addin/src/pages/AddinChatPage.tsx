import {
  FileCapabilitiesProvider,
  ProfileProvider,
} from "@erato/frontend/library";

import { AddinChat } from "../components/AddinChat";
import { AddinChatProvider } from "../providers/AddinChatProvider";

export function AddinChatPage() {
  return (
    <ProfileProvider>
      <FileCapabilitiesProvider>
        <AddinChatProvider>
          <AddinChat />
        </AddinChatProvider>
      </FileCapabilitiesProvider>
    </ProfileProvider>
  );
}
