import { t } from "@lingui/core/macro";
import { skipToken } from "@tanstack/react-query";
import { useCallback, useId, useMemo, useState } from "react";

import { Input } from "@/components/ui/Input/Input";
import { useFuzzySearch } from "@/hooks/search/useFuzzySearch";
import { useOpenMcpServersSettings } from "@/hooks/ui/useOpenMcpServersSettings";
import { useListMcpServerTools } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import {
  isMcpToolDisabled,
  mcpToolCoveringPattern,
} from "@/utils/chat/mcpToolPatterns";

import { Button } from "../Controls/Button";
import { Checkbox } from "../Controls/Checkbox";
import { Alert } from "../Feedback/Alert";
import { ModalBase } from "../Modal/ModalBase";
import { EntityRow } from "../Settings/EntityRow";
import { McpToolGroup } from "../Settings/McpToolGroup";
import { McpToolRow } from "../Settings/McpToolRow";
import {
  mcpServerDescription,
  mcpServerStatus,
} from "../Settings/mcpServerStatus";
import { groupMcpTools } from "../Settings/mcpToolGroups";
import { LinkIcon, ResolvedIcon } from "../icons";
import { describeAllowChanges } from "./mcpToolsSection";

import type {
  McpServerStatus,
  McpServerTool,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ReactNode } from "react";

// Same window as the settings roster: the two surfaces share the query, so
// the one opened second reads the other's listing instead of probing again.
const TOOLS_STALE_TIME_MS = 5 * 60 * 1000;

// eslint-disable-next-line lingui/no-unlocalized-strings -- field names of the server listing
const SEARCH_KEYS = ["display_name", "id"];

const inThisChatCaption = () =>
  t({
    id: "chatInput.connectors.tool.switchCaption",
    message: "In this chat",
  });

/** The per-chat switch of one tool row; absent on a read-only browser. */
interface McpToolSwitch {
  disabledToolPatterns: string[];
  onToggleTool: (serverId: string, toolName: string) => void;
  /** Locks every switch: the chat's list is not known yet, or the server
   * is switched off as a whole so the per-tool state is moot. */
  locked: boolean;
}

function McpToolBrowserRow({
  serverId,
  tool,
  toolSwitch,
}: {
  serverId: string;
  tool: McpServerTool;
  toolSwitch: McpToolSwitch | null;
}) {
  const toolTitle = tool.title;
  const isOn =
    toolSwitch === null ||
    !isMcpToolDisabled(toolSwitch.disabledToolPatterns, serverId, tool.name);
  // A wildcard entry keeps the tool off whatever the switch does, so the
  // switch is shown off and locked rather than claiming a flip would help.
  const coveringPattern =
    toolSwitch === null
      ? null
      : mcpToolCoveringPattern(
          toolSwitch.disabledToolPatterns,
          serverId,
          tool.name,
        );

  return (
    <McpToolRow
      as="li"
      tool={tool}
      muted={!isOn}
      data-testid="mcp-tools-browser-tool"
      control={
        toolSwitch ? (
          <Checkbox
            checked={isOn}
            disabled={toolSwitch.locked || coveringPattern !== null}
            onCheckedChange={() => toolSwitch.onToggleTool(serverId, tool.name)}
            aria-label={t({
              id: "chatInput.connectors.tool.switchLabel",
              message: `Use ${toolTitle} in this chat`,
            })}
            data-testid="mcp-tools-browser-tool-switch"
            label={
              coveringPattern !== null
                ? t({
                    id: "chatInput.connectors.tool.switchedOffByRule",
                    message: `Switched off for this chat by the rule ${coveringPattern}`,
                  })
                : inThisChatCaption()
            }
          />
        ) : undefined
      }
    />
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
      <div className="space-y-4">
        {groupMcpTools(toolsResponse.tools).map(({ key, tools }) => (
          <McpToolGroup
            key={key}
            group={key}
            count={tools.length}
            data-testid="mcp-tools-browser-group"
          >
            {tools.map((tool) => (
              <McpToolBrowserRow
                key={tool.name}
                serverId={serverId}
                tool={tool}
                toolSwitch={toolSwitch}
              />
            ))}
          </McpToolGroup>
        ))}
      </div>
    );
  }

  return <div data-testid="mcp-tools-browser-tools">{body}</div>;
}

export interface McpToolsBrowserModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The servers this chat can use; the rows say which are connected. */
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
   * flip has no base. The rows and the Connect affordance stay live.
   */
  toolSwitchesLocked?: boolean;
  /**
   * Servers switched off for the chat as a whole. Their tools are still
   * listed, but the per-tool switches are moot while the server is off, so
   * they are locked and the row says so.
   */
  disabledServerIds?: string[];
  /** Puts a per-chat switch on every connected server's row. */
  onToggleServer?: (serverId: string) => void;
  /** Locks the server switches alone, for the same reason as the tools'. */
  serverSwitchesLocked?: boolean;
  /**
   * The chat's write setting. Together with `onToggleWriteTools` it puts the
   * "Allow changes" switch in the dialog's footer.
   */
  writeToolsEnabled?: boolean;
  onToggleWriteTools?: () => void;
  writeSwitchLocked?: boolean;
  /**
   * Whether this host also proposes actions of its own (the add-ins), so
   * the write switch's description names that those pause too.
   */
  pausesHostActions?: boolean;
}

/**
 * The connectors dialog behind the composer's "Connectors…" row: every server
 * this chat can use, with a search over their names. Each connected server
 * has a switch for this chat and opens to the tools it offers, each with its
 * own switch; a server still waiting for the user has Connect instead, and
 * those come last. The footer holds the chat's "Allow changes" switch.
 *
 * Account-wide decisions stay in Settings, which this links to, so a decision
 * never has two homes — and the two controls never look alike (a checkbox
 * here, radios there). Connecting opens the settings on that server; a host
 * without the web app's settings dialog supplies its own opener through
 * `McpSettingsOpenProvider`.
 *
 * The write description deliberately says "tools marked read-only": under
 * protocol defaults an unannotated tool is not read-only, so with changes off
 * it disappears too, and "read-only tools" would misdescribe that.
 */
export function McpToolsBrowserModal({
  isOpen,
  onClose,
  servers,
  disabledToolPatterns,
  onToggleTool,
  toolSwitchesLocked = false,
  disabledServerIds = [],
  onToggleServer,
  serverSwitchesLocked = false,
  writeToolsEnabled = true,
  onToggleWriteTools,
  writeSwitchLocked = false,
  pausesHostActions = false,
}: McpToolsBrowserModalProps) {
  const openMcpServersSettings = useOpenMcpServersSettings();
  const writeDescriptionId = useId();
  const [searchQuery, setSearchQuery] = useState("");

  const closeAndReset = useCallback(() => {
    setSearchQuery("");
    onClose();
  }, [onClose]);

  const openSettings = openMcpServersSettings
    ? (serverId?: string) => {
        closeAndReset();
        openMcpServersSettings(serverId);
      }
    : null;

  const matches = useFuzzySearch({
    items: servers,
    keys: SEARCH_KEYS,
    query: searchQuery,
    // The list is short and the user is narrowing it, not searching prose.
    minMatchCharLength: 1,
  });
  // Servers still waiting for the user come last: what this chat can use
  // right now is what people look for first.
  const orderedMatches = useMemo(
    () => [
      ...matches.filter(
        (server) => server.connection_status !== "NEEDS_AUTHENTICATION",
      ),
      ...matches.filter(
        (server) => server.connection_status === "NEEDS_AUTHENTICATION",
      ),
    ],
    [matches],
  );

  const isEditable = onToggleTool !== undefined;

  const writeDescription = describeAllowChanges({
    enabled: writeToolsEnabled,
    pausesHostActions,
  });

  return (
    <ModalBase
      isOpen={isOpen}
      onClose={closeAndReset}
      title={t({
        id: "chatInput.connectors.dialogTitle",
        message: "Connectors",
      })}
      contentClassName="max-w-lg"
      footer={
        onToggleWriteTools ? (
          <div className="space-y-1">
            <Checkbox
              checked={writeToolsEnabled}
              disabled={writeSwitchLocked}
              onCheckedChange={() => onToggleWriteTools()}
              label={t({
                id: "chatInput.connectors.allowChanges.label",
                message: "Allow changes",
              })}
              aria-describedby={writeDescriptionId}
              data-testid="mcp-tools-browser-allow-changes"
            />
            <p
              id={writeDescriptionId}
              className="pl-6 text-sm text-theme-fg-secondary"
            >
              {writeDescription}
            </p>
          </div>
        ) : undefined
      }
    >
      <div className="space-y-3" data-testid="mcp-tools-browser">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-theme-fg-secondary">
            {isEditable
              ? t({
                  id: "chatInput.connectors.dialogDescriptionWithSwitches",
                  message:
                    "What this chat may use. Switch a connector off, or open it to switch single tools off, for this chat only.",
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
              onClick={() => openSettings()}
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
          <>
            <Input
              type="search"
              // Focused in the opening commit, so a key typed right after
              // opening cannot reach the composer behind the overlay.
              autoFocus // eslint-disable-line jsx-a11y/no-autofocus -- the dialog opens to narrow the list
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t({
                id: "chatInput.connectors.searchPlaceholder",
                message: "Search connectors...",
              })}
              aria-label={t({
                id: "chatInput.connectors.searchPlaceholder",
                message: "Search connectors...",
              })}
              data-testid="mcp-tools-browser-search"
            />
            {orderedMatches.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-sm text-theme-fg-muted">
                  {t({
                    id: "chatInput.connectors.noResults",
                    message: "No connectors match your search",
                  })}
                </p>
              </div>
            ) : (
              <div className="max-h-[60vh] space-y-3 overflow-y-auto">
                {orderedMatches.map((server) => {
                  const needsAuthentication =
                    server.connection_status === "NEEDS_AUTHENTICATION";
                  const isServerSwitchedOff = disabledServerIds.includes(
                    server.id,
                  );
                  const serverName = server.display_name;
                  const description = mcpServerDescription(server);
                  const toolSwitch: McpToolSwitch | null =
                    onToggleTool !== undefined
                      ? {
                          disabledToolPatterns: disabledToolPatterns ?? [],
                          onToggleTool,
                          locked: toolSwitchesLocked || isServerSwitchedOff,
                        }
                      : null;
                  let action: ReactNode;
                  if (needsAuthentication) {
                    action = openSettings ? (
                      <Button
                        variant="primary"
                        size="sm"
                        icon={<LinkIcon className="size-4" />}
                        onClick={() => openSettings(server.id)}
                        data-testid="mcp-tools-browser-authorize"
                      >
                        {t({
                          id: "chatInput.connectors.connect",
                          message: "Connect",
                        })}
                      </Button>
                    ) : undefined;
                  } else if (onToggleServer) {
                    action = (
                      <Checkbox
                        checked={!isServerSwitchedOff}
                        disabled={serverSwitchesLocked}
                        onCheckedChange={() => onToggleServer(server.id)}
                        aria-label={t({
                          id: "chatInput.connectors.server.switchLabel",
                          message: `Use ${serverName} in this chat`,
                        })}
                        label={inThisChatCaption()}
                        data-testid="mcp-tools-browser-server-switch"
                      />
                    );
                  }
                  return (
                    <EntityRow
                      key={server.id}
                      icon={
                        <ResolvedIcon
                          iconId="simpleicons-modelcontextprotocol"
                          className="size-4 text-theme-fg-secondary"
                        />
                      }
                      name={serverName}
                      // Switched off, the row says only that: a green
                      // "Connected" tone beside it would read as on.
                      status={
                        isServerSwitchedOff ? null : mcpServerStatus(server)
                      }
                      caption={
                        isServerSwitchedOff
                          ? t({
                              id: "chatInput.connectors.server.switchedOff",
                              message: "Switched off for this chat",
                            })
                          : undefined
                      }
                      data-testid="mcp-tools-browser-server"
                      action={action}
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
          </>
        )}
      </div>
    </ModalBase>
  );
}
