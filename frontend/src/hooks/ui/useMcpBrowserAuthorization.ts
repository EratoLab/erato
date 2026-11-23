import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { watchMcpAuthorization } from "@/lib/mcpAuthorization";

import type { McpSettingsOpener } from "@/providers/McpSettingsOpenProvider";

/** Shared by add-in hosts. The browser owns the redirect and its session
 * storage; the task pane only observes the selected server's actual readiness.
 */
export function useMcpBrowserAuthorization() {
  const queryClient = useQueryClient();
  return useCallback(
    (serverId: string) => {
      // eslint-disable-next-line lingui/no-unlocalized-strings -- Internal routing URL
      const url = `/?preferencesDialog=open&preferencesTab=serversTools&mcpServerId=${encodeURIComponent(serverId)}`;
      watchMcpAuthorization(
        queryClient,
        serverId,
        () => {
          // noopener intentionally supplies no reliable window handle. A null
          // return therefore cannot distinguish a blocked popup from a normal tab.
          // eslint-disable-next-line lingui/no-unlocalized-strings -- Browser window features
          window.open(url, "_blank", "noopener");
        },
        url,
      );
    },
    [queryClient],
  );
}

/**
 * The settings opener for add-in hosts, for `McpSettingsOpenProvider`: the
 * pane has no settings dialog of the web app's kind, so connecting a server
 * authorizes it in the browser, and managing them all opens the web app's
 * settings there.
 */
export function useMcpBrowserSettingsOpener(): McpSettingsOpener {
  const authorizeInBrowser = useMcpBrowserAuthorization();
  return useCallback(
    (serverId?: string) => {
      if (serverId) {
        authorizeInBrowser(serverId);
        return;
      }
      window.open(
        // eslint-disable-next-line lingui/no-unlocalized-strings -- Internal routing URL
        "/?preferencesDialog=open&preferencesTab=serversTools",
        // eslint-disable-next-line lingui/no-unlocalized-strings -- Browser window target
        "_blank",
        "noopener",
      );
    },
    [authorizeInBrowser],
  );
}
