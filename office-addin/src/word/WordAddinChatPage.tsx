import {
  FileCapabilitiesProvider,
  ProfileProvider,
} from "@erato/frontend/library";

import { WordAddinChat } from "./WordAddinChat";
import { WordAddinSessionController } from "./wordSession";
import { AddinChatProviderCore } from "../core/AddinChatProviderCore";

export function WordAddinChatPage() {
  return (
    <ProfileProvider>
      <FileCapabilitiesProvider>
        <AddinChatProviderCore
          platform="word"
          SessionController={WordAddinSessionController}
        >
          <WordAddinChat />
        </AddinChatProviderCore>
      </FileCapabilitiesProvider>
    </ProfileProvider>
  );
}
