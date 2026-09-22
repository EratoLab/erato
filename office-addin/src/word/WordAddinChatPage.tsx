import {
  FileCapabilitiesProvider,
  ProfileProvider,
} from "@erato/frontend/library";

import { WordAddinChat } from "./WordAddinChat";
import { WordAddinSessionController } from "./wordSession";
import { AddinChatProviderCore } from "../core/AddinChatProviderCore";

/**
 * Word composition of generic chat data with the Word session policy.
 *
 * Replaces `NeutralAddinChatPage`, which accepts only a platform and a session
 * controller and exposes no seam for a host composer or for
 * `AddinChatHostCallbacks` — both of which the document read path needs.
 *
 * `platform="word"` is the literal the backend matches action facets on.
 */
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
