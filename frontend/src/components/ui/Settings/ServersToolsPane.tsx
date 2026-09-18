import { t } from "@lingui/core/macro";
import { skipToken } from "@tanstack/react-query";
import { useEffect } from "react";

import { useListMcpServers } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import {
  isMcpAuthorizationPending,
  useMcpAuthorizationStore,
  clearMcpAuthorization,
} from "@/lib/mcpAuthorization";

import { DesktopSidecarRow } from "./DesktopSidecarTabContent";
import { EntityRow } from "./EntityRow";
import { McpToolApprovalSettings } from "./McpToolApprovalSettings";
import { mcpServerDescription, mcpServerStatus } from "./mcpServerStatus";
import { Button } from "../Controls/Button";
import { Alert } from "../Feedback/Alert";
import { SpinnerIcon } from "../Feedback/SpinnerIcon";
import { LinkIcon, LinkSlashIcon, ResolvedIcon } from "../icons";

import type { McpServerStatus } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ReactNode } from "react";

export interface ServersToolsMcpConfig {
  onAuthorize: (serverId: string) => void;
  onDisconnect: (serverId: string) => void;
  selectedServerId?: string;
  /** Also honor pending state supplied by an existing component-kit host. */
  authorizingServerId?: string | null;
  disconnectingServerId?: string | null;
  /**
   * Replaces the Authorize label for hosts that hand the OAuth round-trip
   * elsewhere (the add-in opens the web settings — the IdP redirect and its
   * callback URL are web-shaped).
   */
  authorizeLabel?: ReactNode;
  /** Hosts without an in-place OAuth flow hide Disconnect too. */
  showDisconnect?: boolean;
}

function McpServerEntityRow({
  server,
  mcp,
  isActive,
}: {
  server: McpServerStatus;
  mcp: ServersToolsMcpConfig;
  isActive: boolean;
}) {
  const status = mcpServerStatus(server);
  const description = mcpServerDescription(server);
  const phase = useMcpAuthorizationStore((state) => state.phases[server.id]);
  const isAuthorizing =
    isMcpAuthorizationPending(phase) || mcp.authorizingServerId === server.id;
  const isDisconnecting = mcp.disconnectingServerId === server.id;

  return (
    <EntityRow
      icon={
        <ResolvedIcon
          iconId="simpleicons-modelcontextprotocol"
          className="size-4 text-theme-fg-secondary"
        />
      }
      name={server.id}
      // Work the row is waiting on outranks the connection state it is about
      // to change — and carries the ring, so progress reads on the row itself
      // rather than only in a notice somewhere above the list.
      status={
        isAuthorizing
          ? {
              tone: "pending",
              label: t({
                id: "preferences.dialog.mcpServers.oauth.rowPending",
                message: "Connection in progress…",
              }),
            }
          : isDisconnecting
            ? {
                tone: "pending",
                label: t({
                  id: "preferences.dialog.mcpServers.oauth.disconnecting",
                  message: "Disconnecting...",
                }),
              }
            : status
      }
      defaultExpanded={mcp.selectedServerId === server.id}
      data-testid="servers-tools-mcp-row"
      action={
        server.connection_status === "NEEDS_AUTHENTICATION" || isAuthorizing ? (
          <Button
            variant="primary"
            size="sm"
            icon={<LinkIcon className="size-4" />}
            loading={isAuthorizing}
            onClick={() => mcp.onAuthorize(server.id)}
          >
            {mcp.authorizeLabel ??
              t({
                id: "preferences.dialog.mcpServers.oauth.authorize",
                message: "Authorize",
              })}
          </Button>
        ) : undefined
      }
    >
      {description !== null && !isAuthorizing ? (
        <p className="text-sm text-theme-fg-secondary">{description}</p>
      ) : null}
      {(mcp.showDisconnect ?? true) &&
      server.authentication_mode === "oauth2" &&
      server.connection_status !== "NEEDS_AUTHENTICATION" ? (
        <Button
          variant="secondary"
          size="sm"
          icon={<LinkSlashIcon className="size-4" />}
          loading={isDisconnecting}
          disabled={isAuthorizing}
          onClick={() => mcp.onDisconnect(server.id)}
        >
          {t({
            id: "preferences.dialog.mcpServers.oauth.disconnect",
            message: "Disconnect",
          })}
        </Button>
      ) : null}
      {/* Details unmount on collapse, so this list fetches on expand only. */}
      {!isAuthorizing ? (
        <McpToolApprovalSettings serverId={server.id} isActive={isActive} />
      ) : null}
    </EntityRow>
  );
}

interface ServersToolsPaneProps {
  /** Gates the live server probe to the tab actually being shown. */
  isActive: boolean;
  /** MCP wiring from the host; omit to hide MCP entities (feature off). */
  mcp?: ServersToolsMcpConfig | null;
  showDesktopSidecar?: boolean;
  /** Host-injected entity rows (e.g. the add-in's Outlook actions). */
  children?: ReactNode;
}

/**
 * The Servers & Tools settings pane: one flat list of capability providers.
 * Every entity — MCP server, host actions, sidecar — is an expandable
 * `EntityRow`; storage scope and provider kind are row metadata, never
 * layout, so a new capability class is always one new row.
 */
export function ServersToolsPane({
  isActive,
  mcp,
  showDesktopSidecar = false,
  children,
}: ServersToolsPaneProps) {
  const phases = useMcpAuthorizationStore((state) => state.phases);
  const {
    data: mcpServersResponse,
    error: mcpServersError,
    isLoading: isMcpServersLoading,
    isFetching: isMcpServersFetching,
  } = useListMcpServers(isActive && mcp ? {} : skipToken, {
    retry: false,
    refetchOnWindowFocus: false,
    // Opening the pane IS the refresh: the endpoint live-probes every server,
    // so entering must re-probe rather than show a cached snapshot.
    staleTime: 0,
  });
  const mcpServers = mcpServersResponse?.servers ?? [];
  useEffect(() => {
    if (
      !isActive ||
      !mcp ||
      !mcpServersResponse ||
      isMcpServersFetching ||
      mcpServersError
    )
      return;
    for (const [serverId, phase] of Object.entries(phases)) {
      if (!phase) continue;
      const server = mcpServersResponse.servers.find(
        (entry) => entry.id === serverId,
      );
      if (
        !server ||
        (phase === "connected" && server.connection_status !== "SUCCESS")
      ) {
        clearMcpAuthorization(serverId);
      }
    }
  }, [
    isActive,
    mcp,
    mcpServersResponse,
    isMcpServersFetching,
    mcpServersError,
    phases,
  ]);

  return (
    <div className="space-y-4" data-testid="servers-tools-pane">
      {mcp && mcpServersError ? (
        <Alert type="error">
          {t({
            id: "preferences.dialog.mcpServers.load.error",
            message: "Could not load MCP servers. Please try again.",
          })}
        </Alert>
      ) : null}
      {/* Waiting is not a message about the list — it is the list, not there
          yet. The ring says so without taking an alert's standing. */}
      {mcp && isMcpServersLoading ? (
        <div className="py-8 text-center">
          <SpinnerIcon
            size="xl"
            label={t({
              id: "preferences.dialog.mcpServers.loading",
              message: "Loading MCP server status...",
            })}
          />
        </div>
      ) : null}

      <div className="space-y-3">
        {mcp && !isMcpServersLoading && !mcpServersError
          ? mcpServers.map((server) => (
              <McpServerEntityRow
                key={server.id}
                server={server}
                mcp={mcp}
                isActive={isActive}
              />
            ))
          : null}
        {children}
        {showDesktopSidecar ? <DesktopSidecarRow /> : null}
      </div>

      {mcp &&
      !isMcpServersLoading &&
      !mcpServersError &&
      mcpServers.length === 0 ? (
        <Alert type="info">
          {t({
            id: "preferences.dialog.mcpServers.empty",
            message: "No MCP servers are currently available to you.",
          })}
        </Alert>
      ) : null}
    </div>
  );
}
