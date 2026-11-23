import { skipToken } from "@tanstack/react-query";
import { useMemo } from "react";

import {
  useGetAssistant,
  useListMcpServers,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import {
  useChatInputFeature,
  useUserPreferencesFeature,
} from "@/providers/FeatureConfigProvider";
import { sortMcpServersByName } from "@/utils/chat/mcpServerOrder";

import type { McpServerStatus } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

// The listing live-probes every server, and a composer mounts far more often
// than the settings pane does; a gate does not need a fresh probe each time.
const SERVERS_STALE_TIME_MS = 5 * 60 * 1000;

export interface BrowsableMcpServers {
  /** Every composer-side connector affordance is gated on this. */
  isAvailable: boolean;
  /**
   * The servers this chat can use, connected or not, sorted by name. In an
   * assistant's chat only the assistant's own servers are listed.
   */
  servers: McpServerStatus[];
}

/**
 * MCP discovery for the composer, independently configurable from preferences.
 *
 * An assistant that names its servers limits the chat to them on the server
 * side, so listing the others would offer switches that change nothing. An
 * assistant without a list (`mcp_server_ids` absent) limits nothing. While the
 * assistant is still loading the group stays hidden rather than briefly
 * offering servers it may not use; if it cannot be loaded, the full list is
 * shown and the backend keeps enforcing the limit.
 */
export function useBrowsableMcpServers(
  assistantId?: string,
): BrowsableMcpServers {
  const { mcpServersTabEnabled } = useUserPreferencesFeature();
  const { mcpServersEnabled = mcpServersTabEnabled } = useChatInputFeature();

  const { data } = useListMcpServers(mcpServersEnabled ? {} : skipToken, {
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: SERVERS_STALE_TIME_MS,
  });
  const scopedAssistantId =
    mcpServersEnabled && assistantId ? assistantId : null;
  const assistantQuery = useGetAssistant(
    scopedAssistantId
      ? { pathParams: { assistantId: scopedAssistantId } }
      : skipToken,
    { refetchOnWindowFocus: false },
  );

  const assistantServerIds = assistantQuery.data?.mcp_server_ids;
  const isAssistantPending =
    scopedAssistantId !== null && assistantQuery.isPending;

  return useMemo(() => {
    if (!mcpServersEnabled || isAssistantPending) {
      return { isAvailable: false, servers: [] };
    }
    const listed = data?.servers ?? [];
    const scoped =
      assistantServerIds == null
        ? listed
        : listed.filter((server) => assistantServerIds.includes(server.id));
    const servers = sortMcpServersByName(scoped);
    return {
      isAvailable: servers.length > 0,
      servers,
    };
  }, [assistantServerIds, data, isAssistantPending, mcpServersEnabled]);
}
