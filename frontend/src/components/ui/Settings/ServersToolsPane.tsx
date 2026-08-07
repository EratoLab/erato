import { t } from "@lingui/core/macro";
import { skipToken } from "@tanstack/react-query";

import { useListMcpServers } from "@/lib/generated/v1betaApi/v1betaApiComponents";

import { DesktopSidecarRow } from "./DesktopSidecarTabContent";
import { EntityRow } from "./EntityRow";
import { McpToolApprovalSettings } from "./McpToolApprovalSettings";
import { Button } from "../Controls/Button";
import { Alert } from "../Feedback/Alert";
import { LinkIcon, LinkSlashIcon, ResolvedIcon } from "../icons";

import type { EntityRowStatus } from "./EntityRow";
import type { McpServerStatus } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ReactNode } from "react";

export interface ServersToolsMcpConfig {
  onAuthorize: (serverId: string) => void;
  onDisconnect: (serverId: string) => void;
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

const mcpServerStatus = (server: McpServerStatus): EntityRowStatus => {
  switch (server.connection_status) {
    case "SUCCESS":
      return {
        tone: "success",
        label: t({
          id: "preferences.dialog.mcpServers.status.success.label",
          message: "Connected",
        }),
      };
    case "NEEDS_AUTHENTICATION":
      return {
        tone: "warning",
        label: t({
          id: "preferences.dialog.mcpServers.status.needsAuthentication.label",
          message: "Needs authentication",
        }),
      };
    default:
      return {
        tone: "error",
        label: t({
          id: "preferences.dialog.mcpServers.status.failure.label",
          message: "Connection failed",
        }),
      };
  }
};

const mcpServerDescription = (server: McpServerStatus): string => {
  switch (server.connection_status) {
    case "SUCCESS":
      return t({
        id: "preferences.dialog.mcpServers.status.success.description",
        message: "Connected and ready to use.",
      });
    case "NEEDS_AUTHENTICATION":
      return t({
        id: "preferences.dialog.mcpServers.status.needsAuthentication.description",
        message: "Authorization is required before this server can be used.",
      });
    default:
      return t({
        id: "preferences.dialog.mcpServers.status.failure.description",
        message:
          "The server is configured, but the backend could not connect to it.",
      });
  }
};

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
  const isAuthorizing = mcp.authorizingServerId === server.id;
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
      status={status}
      data-testid="servers-tools-mcp-row"
      action={
        server.connection_status === "NEEDS_AUTHENTICATION" ? (
          <Button
            variant="primary"
            size="sm"
            icon={<LinkIcon className="size-4" />}
            disabled={isAuthorizing}
            onClick={() => mcp.onAuthorize(server.id)}
          >
            {isAuthorizing
              ? t({
                  id: "preferences.dialog.mcpServers.oauth.authorizing",
                  message: "Authorizing...",
                })
              : (mcp.authorizeLabel ??
                t({
                  id: "preferences.dialog.mcpServers.oauth.authorize",
                  message: "Authorize",
                }))}
          </Button>
        ) : undefined
      }
    >
      <p className="text-sm text-theme-fg-secondary">
        {mcpServerDescription(server)}
      </p>
      {(mcp.showDisconnect ?? true) &&
      server.authentication_mode === "oauth2" &&
      server.connection_status !== "NEEDS_AUTHENTICATION" ? (
        <Button
          variant="secondary"
          size="sm"
          icon={<LinkSlashIcon className="size-4" />}
          disabled={isDisconnecting}
          onClick={() => mcp.onDisconnect(server.id)}
        >
          {isDisconnecting
            ? t({
                id: "preferences.dialog.mcpServers.oauth.disconnecting",
                message: "Disconnecting...",
              })
            : t({
                id: "preferences.dialog.mcpServers.oauth.disconnect",
                message: "Disconnect",
              })}
        </Button>
      ) : null}
      <McpToolApprovalSettings isActive={isActive} serverId={server.id} />
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
  const {
    data: mcpServersResponse,
    error: mcpServersError,
    isLoading: isMcpServersLoading,
  } = useListMcpServers(isActive && mcp ? {} : skipToken, {
    retry: false,
    refetchOnWindowFocus: false,
    // Opening the pane IS the refresh: the endpoint live-probes every server,
    // so entering must re-probe rather than show a cached snapshot.
    staleTime: 0,
  });
  const mcpServers = mcpServersResponse?.servers ?? [];

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
      {mcp && isMcpServersLoading ? (
        <Alert type="info">
          {t({
            id: "preferences.dialog.mcpServers.loading",
            message: "Loading MCP server status...",
          })}
        </Alert>
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
