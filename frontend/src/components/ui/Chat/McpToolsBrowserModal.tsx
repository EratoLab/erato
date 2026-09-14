import { t } from "@lingui/core/macro";
import { skipToken } from "@tanstack/react-query";
import { useId } from "react";

import { useOpenMcpServersSettings } from "@/hooks/ui/useOpenMcpServersSettings";
import { useListMcpServerTools } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { isMcpToolDisabled } from "@/utils/chat/mcpToolPatterns";

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

import type {
  McpServerStatus,
  McpServerTool,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ReactNode } from "react";

// Same window as the settings roster: the two surfaces share the query, so
// the one opened second reads the other's listing instead of probing again.
const TOOLS_STALE_TIME_MS = 5 * 60 * 1000;

/** The per-chat switch of one tool row; absent on a read-only browser. */
interface McpToolSwitch {
  disabledToolPatterns: string[];
  onToggleTool: (serverId: string, toolName: string) => void;
  /** Locks every switch: the chat's list is not known yet, or the server
   * is switched off as a whole so the per-tool state is moot. */
  locked: boolean;
}

function McpToolRow({
  serverId,
  tool,
  toolSwitch,
}: {
  serverId: string;
  tool: McpServerTool;
  toolSwitch: McpToolSwitch | null;
}) {
  const switchId = useId();
  const toolTitle = tool.title;
  const isOn =
    toolSwitch === null ||
    !isMcpToolDisabled(toolSwitch.disabledToolPatterns, serverId, tool.name);

  return (
    <li
      data-testid="mcp-tools-browser-tool"
      data-tool-name={tool.name}
      className="flex items-start justify-between gap-3"
    >
      <div className={isOn ? undefined : "opacity-60"}>
        <McpToolSummary tool={tool} />
      </div>
      {toolSwitch ? (
        <label
          htmlFor={switchId}
          className="flex shrink-0 cursor-pointer items-center gap-2 text-xs text-theme-fg-secondary"
        >
          <input
            id={switchId}
            type="checkbox"
            checked={isOn}
            disabled={toolSwitch.locked}
            onChange={() => toolSwitch.onToggleTool(serverId, tool.name)}
            aria-label={t({
              id: "chatInput.connectors.tool.switchLabel",
              message: `Use ${toolTitle} in this chat`,
            })}
            data-testid="mcp-tools-browser-tool-switch"
            className="size-4 accent-[var(--theme-fg-accent)] focus:ring-theme-fg-accent focus:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50"
          />
          <span aria-hidden="true">
            {t({
              id: "chatInput.connectors.tool.switchCaption",
              message: "In this chat",
            })}
          </span>
        </label>
      ) : null}
    </li>
  );
}

/**
 * One server's tools. Mounted inside the server's entity row, whose details
 * unmount on collapse, so mounting IS the expand. With a switch handed in,
 * each row carries the chat's per-tool switch; without one it is read-only.
 */
function McpServerToolsList({
  serverId,
  isActive,
  toolSwitch,
}: {
  serverId: string;
  isActive: boolean;
  toolSwitch: McpToolSwitch | null;
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
          <McpToolRow
            key={tool.name}
            serverId={serverId}
            tool={tool}
            toolSwitch={toolSwitch}
          />
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
  /**
   * The chat's switched-off `server/tool` patterns. Together with
   * `onToggleTool` it puts a per-chat switch on every tool row; a host that
   * passes neither gets the read-only browser.
   */
  disabledToolPatterns?: string[];
  onToggleTool?: (serverId: string, toolName: string) => void;
  /**
   * Locks the tool switches alone: the chat's list is not known yet, so a
   * flip has no base. The rows and the Authorize affordance stay live.
   */
  toolSwitchesLocked?: boolean;
  /**
   * Servers switched off for the chat as a whole. Their tools are still
   * listed — the server switch is in the composer, not here — but the
   * per-tool switches are moot while it is off, so they are locked and the
   * row says so.
   */
  disabledServerIds?: string[];
}

/**
 * The tool list behind the composer's "Browse tools…" row: every server the
 * user may see, each expanding to the tools the model is offered from it,
 * with the same badges the settings pane shows. Where the host hands in the
 * chat's per-tool switch, each row flips that one tool for this chat alone;
 * the account-wide decisions stay in Settings, which this links to, so a
 * decision never has two homes — and the two controls never look alike
 * (a checkbox here, radios there).
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
  disabledToolPatterns,
  onToggleTool,
  toolSwitchesLocked = false,
  disabledServerIds = [],
}: McpToolsBrowserModalProps) {
  const openMcpServersSettings = useOpenMcpServersSettings();

  const openSettings = openMcpServersSettings
    ? () => {
        onClose();
        openMcpServersSettings();
      }
    : null;

  const isEditable = onToggleTool !== undefined;

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
            {isEditable
              ? t({
                  id: "chatInput.connectors.browseDescriptionWithSwitches",
                  message:
                    "The tools each connected server offers in this chat. Switch a tool off to keep it out of this chat; decide what may run for you at all in Settings.",
                })
              : t({
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
              const isServerSwitchedOff = disabledServerIds.includes(server.id);
              const description = mcpServerDescription(server);
              const toolSwitch: McpToolSwitch | null =
                onToggleTool !== undefined
                  ? {
                      disabledToolPatterns: disabledToolPatterns ?? [],
                      onToggleTool,
                      locked: toolSwitchesLocked || isServerSwitchedOff,
                    }
                  : null;
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
                  caption={
                    isServerSwitchedOff
                      ? t({
                          id: "chatInput.connectors.server.switchedOff",
                          message: "Switched off for this chat",
                        })
                      : undefined
                  }
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
                      toolSwitch={toolSwitch}
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
