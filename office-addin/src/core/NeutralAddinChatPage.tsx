import {
  FileCapabilitiesProvider,
  ProfileProvider,
} from "@erato/frontend/library";

import { AddinChatCore } from "./AddinChatCore";
import { AddinChatProviderCore } from "./AddinChatProviderCore";

import type { AddinChatHostProps } from "./AddinChatCore";
import type { AddinSessionControllerProps } from "./AddinChatProviderCore";
import type { ComponentType } from "react";

/**
 * Ready-to-compose neutral chat surface. The caller owns authentication and
 * the host SDK lifecycle; this component only needs the shared API shell.
 */
export function NeutralAddinChatPage({
  platform = "addin-neutral",
  SessionController,
  Host,
}: {
  platform?: string;
  /** Host session adapter; defaults to the neutral storage-only controller. */
  SessionController?: ComponentType<AddinSessionControllerProps>;
  /** Replaces the neutral host, e.g. one built by `createNeutralAddinChatHost`. */
  Host?: ComponentType<AddinChatHostProps>;
}) {
  return (
    <ProfileProvider>
      <FileCapabilitiesProvider>
        <AddinChatProviderCore
          platform={platform}
          SessionController={SessionController}
        >
          <AddinChatCore Host={Host} />
        </AddinChatProviderCore>
      </FileCapabilitiesProvider>
    </ProfileProvider>
  );
}
