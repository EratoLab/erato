import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { watchMcpAuthorization } from "@/lib/mcpAuthorization";

/** Shared by add-in hosts. The browser owns the redirect and its session
 * storage; the task pane only observes the selected server's actual readiness.
 */
export function useMcpBrowserAuthorization() {
  const queryClient = useQueryClient();
  return useCallback(
    (serverId: string) => {
      watchMcpAuthorization(queryClient, serverId, () => {
        // eslint-disable-next-line lingui/no-unlocalized-strings -- Internal routing URL
        const url = `/?preferencesDialog=open&preferencesTab=serversTools&mcpServerId=${encodeURIComponent(serverId)}`;
        // noopener intentionally supplies no reliable window handle. A null
        // return therefore cannot distinguish a blocked popup from a normal tab.
        // eslint-disable-next-line lingui/no-unlocalized-strings -- Browser window features
        window.open(url, "_blank", "noopener");
      });
    },
    [queryClient],
  );
}
