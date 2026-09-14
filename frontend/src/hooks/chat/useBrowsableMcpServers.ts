import { skipToken } from "@tanstack/react-query";
import { useMemo } from "react";

import { useListMcpServers } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { useUserPreferencesFeature } from "@/providers/FeatureConfigProvider";

import type { McpServerStatus } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

// The listing live-probes every server, and a composer mounts far more often
// than the settings pane does; a gate does not need a fresh probe each time.
const SERVERS_STALE_TIME_MS = 5 * 60 * 1000;

export interface BrowsableMcpServers {
  /** Every composer-side connector affordance is gated on this. */
  isAvailable: boolean;
  /** Every server the user may see, connected or not, for the browser. */
  servers: McpServerStatus[];
}

/**
 * The MCP servers the composer may offer to browse. Available only where the
 * host enables the Servers & Tools settings — the same flag the settings
 * dialog reads, injected by the host through the feature config — and at
 * least one server is actually connected for this user; the query stays
 * unissued while the flag is off, so a deployment without MCP pays nothing.
 */
export function useBrowsableMcpServers(): BrowsableMcpServers {
  const { mcpServersTabEnabled } = useUserPreferencesFeature();

  const { data } = useListMcpServers(mcpServersTabEnabled ? {} : skipToken, {
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: SERVERS_STALE_TIME_MS,
  });

  return useMemo(() => {
    const servers = data?.servers ?? [];
    return {
      isAvailable:
        mcpServersTabEnabled &&
        servers.some((server) => server.connection_status === "SUCCESS"),
      servers,
    };
  }, [data, mcpServersTabEnabled]);
}
