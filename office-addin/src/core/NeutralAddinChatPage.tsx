import {
  FileCapabilitiesProvider,
  ProfileProvider,
} from "@erato/frontend/library";

import { AddinChatCore } from "./AddinChatCore";
import { AddinChatProviderCore } from "./AddinChatProviderCore";

import type { AddinSessionControllerProps } from "./AddinChatProviderCore";
import type { ComponentType } from "react";

/**
 * Ready-to-compose neutral chat surface. The caller owns authentication and
 * the host SDK lifecycle; this component only needs the shared API shell.
 */
export function NeutralAddinChatPage({
  platform = "addin-neutral",
  SessionController,
}: {
  platform?: string;
  /** Host session adapter; defaults to the neutral storage-only controller. */
  SessionController?: ComponentType<AddinSessionControllerProps>;
}) {
  return (
    <ProfileProvider>
      <FileCapabilitiesProvider>
        <AddinChatProviderCore
          platform={platform}
          SessionController={SessionController}
        >
          <AddinChatCore />
        </AddinChatProviderCore>
      </FileCapabilitiesProvider>
    </ProfileProvider>
  );
}
