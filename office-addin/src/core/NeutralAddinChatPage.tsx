import {
  FileCapabilitiesProvider,
  ProfileProvider,
} from "@erato/frontend/library";

import { AddinChatCore } from "./AddinChatCore";
import { AddinChatProviderCore } from "./AddinChatProviderCore";

/**
 * Ready-to-compose neutral chat surface. The caller owns authentication and
 * the host SDK lifecycle; this component only needs the shared API shell.
 */
export function NeutralAddinChatPage({
  platform = "addin-neutral",
}: {
  platform?: string;
}) {
  return (
    <ProfileProvider>
      <FileCapabilitiesProvider>
        <AddinChatProviderCore platform={platform}>
          <AddinChatCore />
        </AddinChatProviderCore>
      </FileCapabilitiesProvider>
    </ProfileProvider>
  );
}
