import { t } from "@lingui/core/macro";
import { skipToken } from "@tanstack/react-query";

import { useOpenMcpServersSettings } from "@/hooks/ui/useOpenMcpServersSettings";
import { useListMcpServerTools } from "@/lib/generated/v1betaApi/v1betaApiComponents";

import { Button } from "../Controls/Button";
import { Alert } from "../Feedback/Alert";
import { ModalBase } from "../Modal/ModalBase";
import { EntityRow } from "../Settings/EntityRow";
import { McpToolSummary } from "../Settings/McpToolSummary";
import {
  mcpServerDescription,
  mcpServerStatus,
} from "../Settings/mcpServerStatus";
import { LinkIcon, ResolvedIcon } from "../icons";

import type { McpServerStatus } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ReactNode } from "react";

// Same window as the settings roster: the two surfaces share the query, so
// the one opened second reads the other's listing instead of probing again.
const TOOLS_STALE_TIME_MS = 5 * 60 * 1000;

/**
 * One server's tools, read-only. Mounted inside the server's entity row,
 * whose details unmount on collapse, so mounting IS the expand.
 */
function McpServerToolsList({
  serverId,
  isActive,
}: {
  serverId: string;
  isActive: boolean;
}) {
  const {
    data: toolsResponse,
    error: toolsError,
    isLoading: isToolsLoading,
  } = useListMcpServerTools(
    isActive ? { pathParams: { serverId } } : skipToken,
    {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: (query) =>
        query.state.data?.status === "SUCCESS" ? TOOLS_STALE_TIME_MS : 0,
    },
  );

  let body: ReactNode;
  if (toolsError) {
    body = (
      <Alert type="error">
        {t({
          id: "preferences.dialog.mcpServers.tools.loadError",
          message: "Could not load the tools of this server. Please try again.",
        })}
      </Alert>
    );
  } else if (isToolsLoading || !toolsResponse) {
    body = (
      <p className="text-xs text-theme-fg-secondary">
        {t({
          id: "preferences.dialog.mcpServers.tools.loading",
          message: "Loading tools...",
        })}
      </p>
    );
  } else if (toolsResponse.status === "NEEDS_AUTHENTICATION") {
    body = (
      <p className="text-xs text-theme-fg-secondary">
        {t({
          id: "preferences.dialog.mcpServers.tools.needsAuthentication",
          message: "Connect to see tools.",
        })}
      </p>
    );
  } else if (toolsResponse.status !== "SUCCESS") {
    body = (
      <p className="text-xs text-theme-fg-secondary">
        {t({
          id: "preferences.dialog.mcpServers.tools.failure",
          message:
            "The tools could not be listed because the server is unreachable.",
        })}
      </p>
    );
  } else if (toolsResponse.tools.length === 0) {
    body = (
      <p className="text-sm italic text-theme-fg-muted">
        {t({
          id: "preferences.dialog.mcpServers.tools.empty",
          message: "This server exposes no tools to you.",
        })}
      </p>
    );
  } else {
    body = (
      <ul className="space-y-3">
        {toolsResponse.tools.map((tool) => (
          <li
            key={tool.name}
            data-testid="mcp-tools-browser-tool"
            data-tool-name={tool.name}
          >
            <McpToolSummary tool={tool} />
          </li>
        ))}
      </ul>
    );
  }

  return <div data-testid="mcp-tools-browser-tools">{body}</div>;
}

export interface McpToolsBrowserModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Every server the user may see; the rows say which are connected. */
  servers: McpServerStatus[];
}

/**
 * The tool list behind the composer's "Browse tools…" row: every server the
 * user may see, each expanding to the tools the model is offered from it,
 * with the same badges the settings pane shows. Read-only on purpose —
 * decisions about a tool are made in Settings, which this links to, so a
 * decision never has two homes.
 *
 * A server awaiting the user's OAuth connection shows the Authorize
 * affordance instead of tools. The OAuth round-trip is web-shaped and lives
 * in the settings dialog, so authorizing means opening it there; hosts with
 * no such dialog (the add-in) get the status line alone.
 */
export function McpToolsBrowserModal({
  isOpen,
  onClose,
  servers,
}: McpToolsBrowserModalProps) {
  const openMcpServersSettings = useOpenMcpServersSettings();

  const openSettings = openMcpServersSettings
    ? () => {
        onClose();
        openMcpServersSettings();
      }
    : null;

  return (
    <ModalBase
      isOpen={isOpen}
      onClose={onClose}
      title={t({
        id: "chatInput.connectors.browseTitle",
        message: "Connected tools",
      })}
      contentClassName="max-w-lg"
    >
      <div className="space-y-3" data-testid="mcp-tools-browser">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-theme-fg-secondary">
            {t({
              id: "chatInput.connectors.browseDescription",
              message:
                "The tools each connected server offers in your chats. Decide what may run in Settings.",
            })}
          </p>
          {openSettings && (
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={openSettings}
              data-testid="mcp-tools-browser-manage"
            >
              {t({
                id: "chatInput.connectors.manageInSettings",
                message: "Manage in Settings",
              })}
            </Button>
          )}
        </div>

        {servers.length === 0 ? (
          <Alert type="info">
            {t({
              id: "preferences.dialog.mcpServers.empty",
              message: "No MCP servers are currently available to you.",
            })}
          </Alert>
        ) : (
          <div className="max-h-[60vh] space-y-3 overflow-y-auto">
            {servers.map((server) => {
              const needsAuthentication =
                server.connection_status === "NEEDS_AUTHENTICATION";
              const description = mcpServerDescription(server);
              return (
                <EntityRow
                  key={server.id}
                  icon={
                    <ResolvedIcon
                      iconId="simpleicons-modelcontextprotocol"
                      className="size-4 text-theme-fg-secondary"
                    />
                  }
                  name={server.id}
                  status={mcpServerStatus(server)}
                  data-testid="mcp-tools-browser-server"
                  action={
                    needsAuthentication && openSettings ? (
                      <Button
                        variant="primary"
                        size="sm"
                        icon={<LinkIcon className="size-4" />}
                        onClick={openSettings}
                        data-testid="mcp-tools-browser-authorize"
                      >
                        {t({
                          id: "preferences.dialog.mcpServers.oauth.authorize",
                          message: "Authorize",
                        })}
                      </Button>
                    ) : undefined
                  }
                >
                  {description !== null ? (
                    <p className="text-sm text-theme-fg-secondary">
                      {description}
                    </p>
                  ) : null}
                  {/* Nothing to list before the user connects; the
                      enumeration would only echo the status back. */}
                  {needsAuthentication ? null : (
                    <McpServerToolsList
                      serverId={server.id}
                      isActive={isOpen}
                    />
                  )}
                </EntityRow>
              );
            })}
          </div>
        )}
      </div>
    </ModalBase>
  );
}
