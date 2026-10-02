import { skipToken } from "@tanstack/react-query";
import { useMemo } from "react";

import { useListMcpServers } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import {
  useChatInputFeature,
  useUserPreferencesFeature,
} from "@/providers/FeatureConfigProvider";

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

/** MCP discovery for the composer, independently configurable from preferences. */
export function useBrowsableMcpServers(): BrowsableMcpServers {
  const { mcpServersTabEnabled } = useUserPreferencesFeature();
  const { mcpServersEnabled = mcpServersTabEnabled } = useChatInputFeature();

  const { data } = useListMcpServers(mcpServersEnabled ? {} : skipToken, {
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: SERVERS_STALE_TIME_MS,
  });

  return useMemo(() => {
    const servers = mcpServersEnabled ? (data?.servers ?? []) : [];
    return {
      isAvailable: servers.length > 0,
      servers,
    };
  }, [data, mcpServersEnabled]);
}
