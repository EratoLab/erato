import { plural, t } from "@lingui/core/macro";

import { countDisabledMcpTools } from "@/utils/chat/mcpToolPatterns";

import {
  mcpServerDescription,
  mcpServerStatus,
} from "../Settings/mcpServerStatus";

import type { AddMenuSection, AddMenuSectionItem } from "./ChatInputAddMenu";
import type { McpServerStatus } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export const MCP_TOOLS_SECTION_ID = "mcp-tools";
export const MCP_TOOLS_WRITE_TOGGLE_ITEM_ID = "allow-write-operations";
export const MCP_TOOLS_BROWSE_ITEM_ID = "browse-tools";
// Prefixed so a server id can never coincide with one of the fixed rows.
export const MCP_TOOLS_SERVER_ITEM_ID_PREFIX = "server-";

export const mcpToolsServerItemId = (serverId: string) =>
  `${MCP_TOOLS_SERVER_ITEM_ID_PREFIX}${serverId}`;

interface McpToolsSectionOptions {
  /** The chat's current write setting; the toggle row shows it as checked. */
  writeToolsEnabled: boolean;
  onToggleWriteTools: () => void;
  onBrowse: () => void;
  /**
   * The servers offered to this chat, one row each above the write switch.
   * A server's id doubles as its label — the listing carries no other name.
   */
  servers?: McpServerStatus[];
  /** Servers the user switched off for this chat; their rows are unticked. */
  disabledServerIds?: string[];
  onToggleServer?: (serverId: string) => void;
  /**
   * Locks the server switches alone: the chat's list is not known yet, so a
   * flip has no base. The connect rows, the write switch and the browser row
   * stay live.
   */
  serverSwitchesLocked?: boolean;
  /**
   * The chat's switched-off `server/tool` patterns; a server row that is on
   * says how many of its tools are off, which is the trail into the browser
   * where they are switched.
   */
  disabledToolPatterns?: string[];
  /**
   * Where a server still awaiting the user's authorization sends them: its
   * row is not a switch — there is nothing to switch off — but the way to
   * connect.
   */
  onConnect?: () => void;
  disabled?: boolean;
  /**
   * Whether this host also proposes actions of its own — the Outlook add-in
   * sends its action facet with every request — so the toggle's description
   * names that those pause too. Copy only; the switch itself is one control.
   */
  pausesHostActions?: boolean;
}

/**
 * The "Connectors" group in its host-neutral form: one switch per server,
 * the per-chat write switch and the row into the tool browser. Both composer
 * surfaces — the mobile "+" menu and the desktop tool dropdown — render this
 * same data.
 *
 * A server row is ticked while the server is on for the chat, so the group
 * reads like the tool rows above it: ticked means offered. A server whose
 * connection failed keeps a live switch — it may have been switched off
 * while healthy and must stay re-enableable — and says why it is idle.
 *
 * The write description deliberately says "tools the server marks
 * read-only": under protocol defaults an unannotated tool is not read-only,
 * so with writes off it disappears too, and "read-only tools" would
 * misdescribe that.
 */
export function buildMcpToolsSection({
  writeToolsEnabled,
  onToggleWriteTools,
  onBrowse,
  servers = [],
  disabledServerIds = [],
  onToggleServer,
  serverSwitchesLocked = false,
  disabledToolPatterns = [],
  onConnect,
  disabled = false,
  pausesHostActions = false,
}: McpToolsSectionOptions): AddMenuSection {
  const disabledServerIdSet = new Set(disabledServerIds);

  // Only a healthy, switched-on server gets the count: a failed server's
  // row explains the failure instead, and a switched-off one offers nothing
  // for the count to narrow. A wildcard entry has no number without the
  // roster, so the row says how far it reaches instead.
  const disabledToolsDescription = (server: McpServerStatus) => {
    if (
      server.connection_status !== "SUCCESS" ||
      disabledServerIdSet.has(server.id)
    ) {
      return undefined;
    }
    const disabledToolCount = countDisabledMcpTools(
      disabledToolPatterns,
      server.id,
    );
    if (disabledToolCount === "all") {
      return t({
        id: "chatInput.connectors.server.allToolsDisabled",
        message: "All tools switched off",
      });
    }
    if (disabledToolCount === "some") {
      return t({
        id: "chatInput.connectors.server.someToolsDisabled",
        message: "Some tools switched off",
      });
    }
    if (disabledToolCount === 0) {
      return undefined;
    }
    return t({
      id: "chatInput.connectors.server.disabledTools",
      message: plural(disabledToolCount, {
        one: "# tool switched off",
        other: "# tools switched off",
      }),
    });
  };

  const serverItems: AddMenuSectionItem[] = servers.map((server) => {
    const id = mcpToolsServerItemId(server.id);
    if (server.connection_status === "NEEDS_AUTHENTICATION") {
      return {
        id,
        label: server.id,
        description: mcpServerStatus(server).label,
        disabled: disabled || !onConnect,
        closesImmediately: true,
        onSelect: () => onConnect?.(),
      };
    }
    return {
      id,
      label: server.id,
      description:
        mcpServerDescription(server) ?? disabledToolsDescription(server),
      checked: !disabledServerIdSet.has(server.id),
      disabled: disabled || serverSwitchesLocked,
      onToggle: () => onToggleServer?.(server.id),
    };
  });

  return {
    id: MCP_TOOLS_SECTION_ID,
    header: t({
      id: "chatInput.connectors.sectionHeader",
      message: "Connectors",
    }),
    // eslint-disable-next-line lingui/no-unlocalized-strings -- AddMenuSection placement enum
    placement: "belowTools",
    items: [
      ...serverItems,
      {
        id: MCP_TOOLS_WRITE_TOGGLE_ITEM_ID,
        label: t({
          id: "chatInput.connectors.allowWrites.label",
          message: "Allow write operations",
        }),
        description: pausesHostActions
          ? // Host-neutral on purpose: every Office.js host that proposes
            // actions of its own inherits this one string through the shared
            // composer, so naming Outlook (or its Reply and Send buttons)
            // would be wrong in a Word or Teams pane. The id moved with the
            // wording so the existing de/fr/es/pl translations — which all
            // name Outlook — are re-translated rather than silently kept.
            t({
              id: "chatInput.connectors.allowWrites.descriptionHostActions",
              message:
                "Off, only tools the server marks read-only are offered. Also pauses actions in the host application.",
            })
          : t({
              id: "chatInput.connectors.allowWrites.description",
              message:
                "Off, only tools the server marks read-only are offered.",
            }),
        checked: writeToolsEnabled,
        disabled,
        onToggle: onToggleWriteTools,
      },
      {
        id: MCP_TOOLS_BROWSE_ITEM_ID,
        label: t({
          id: "chatInput.connectors.browse",
          message: "Browse tools…",
        }),
        disabled,
        closesImmediately: true,
        onSelect: onBrowse,
      },
    ],
  };
}
