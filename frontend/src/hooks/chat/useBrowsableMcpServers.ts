import { skipToken } from "@tanstack/react-query";
import { useMemo } from "react";

import {
  useChatDetail,
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
 * assistant without a list (`mcp_server_ids` absent) limits nothing. The
 * assistant is the one handed in for a new chat, else the one stored with the
 * existing chat: hosts pass `assistantId` only until the chat exists. While
 * either is still loading the group stays hidden rather than briefly offering
 * servers it may not use; if one cannot be loaded, the full list is shown and
 * the backend keeps enforcing the limit.
 */
export function useBrowsableMcpServers({
  assistantId,
  chatId,
}: {
  assistantId?: string;
  chatId?: string | null;
} = {}): BrowsableMcpServers {
  const { mcpServersTabEnabled } = useUserPreferencesFeature();
  const { mcpServersEnabled = mcpServersTabEnabled } = useChatInputFeature();

  const { data } = useListMcpServers(mcpServersEnabled ? {} : skipToken, {
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: SERVERS_STALE_TIME_MS,
  });
  // Same query as the per-chat connector hooks, so it is read once.
  const readsChatAssistant = mcpServersEnabled && !assistantId && !!chatId;
  const chatQuery = useChatDetail(
    readsChatAssistant && chatId ? { pathParams: { chatId } } : skipToken,
    { retry: false, refetchOnWindowFocus: false },
  );
  const isChatPending = readsChatAssistant && chatQuery.isPending;
  const chatAssistantId = readsChatAssistant
    ? chatQuery.data?.assistant_id
    : undefined;

  // The chat's assistant is read only when none was handed in.
  const effectiveAssistantId = chatAssistantId ?? assistantId;
  const scopedAssistantId =
    mcpServersEnabled && effectiveAssistantId ? effectiveAssistantId : null;
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
    if (!mcpServersEnabled || isChatPending || isAssistantPending) {
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
  }, [
    assistantServerIds,
    data,
    isAssistantPending,
    isChatPending,
    mcpServersEnabled,
  ]);
}
