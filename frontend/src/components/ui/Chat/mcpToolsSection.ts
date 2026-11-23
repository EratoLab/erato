import { plural, t } from "@lingui/core/macro";

import type { AddMenuSection } from "./ChatInputAddMenu";
import type { McpServerStatus } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export const MCP_TOOLS_SECTION_ID = "mcp-tools";
export const MCP_TOOLS_OPEN_ITEM_ID = "connectors";

/**
 * What the chat's "Allow changes" switch means in its current state, for the
 * switch itself and for the "Read only" mode. Off says "tools the server marks
 * read-only" on purpose: an unannotated tool is not read-only under protocol
 * defaults, so it disappears too, and "read-only tools" would misdescribe it.
 */
export function describeAllowChanges({
  enabled,
  pausesHostActions,
}: {
  enabled: boolean;
  /** Whether the host proposes actions of its own, which pause too. */
  pausesHostActions: boolean;
}): string {
  if (enabled) {
    return t({
      id: "chatInput.connectors.allowChanges.descriptionOn",
      message: "Connected tools may create, change and delete things.",
    });
  }
  return pausesHostActions
    ? t({
        id: "chatInput.connectors.allowChanges.descriptionOffHostActions",
        message:
          "Off: only tools the server marks read-only are offered, and actions in this application are paused.",
      })
    : t({
        id: "chatInput.connectors.allowChanges.descriptionOff",
        message: "Off: only tools the server marks read-only are offered.",
      });
}

// Up to this many switched-off servers are named in the summary; more are
// counted instead, so the line stays one line.
const NAMED_OFF_LIMIT = 2;

interface McpToolsSectionOptions {
  /** The servers this chat can use, sorted the way the dialog lists them. */
  servers: McpServerStatus[];
  /** Servers the user switched off for this chat. */
  disabledServerIds?: string[];
  /** The chat's write setting; off is part of the summary. */
  writeToolsEnabled: boolean;
  /** Opens the connectors dialog. */
  onOpen: () => void;
  disabled?: boolean;
}

/**
 * The state of the connectors in one line, exceptions first: which are
 * switched off, how many still need the user to connect, and whether changes
 * are paused. A server that failed to connect counts as on — it was not
 * switched off, and the dialog says why it is idle.
 */
export function summarizeMcpConnectors({
  servers,
  disabledServerIds = [],
  writeToolsEnabled,
}: Pick<
  McpToolsSectionOptions,
  "servers" | "disabledServerIds" | "writeToolsEnabled"
>): string {
  const disabled = new Set(disabledServerIds);
  const switchable = servers.filter(
    (server) => server.connection_status !== "NEEDS_AUTHENTICATION",
  );
  const off = switchable.filter((server) => disabled.has(server.id));
  const onCount = switchable.length - off.length;
  const toConnectCount = servers.length - switchable.length;

  const parts: string[] = [];
  if (off.length === 0) {
    if (onCount > 0) {
      parts.push(
        t({
          id: "chatInput.connectors.summary.allOn",
          message: plural(onCount, { one: "# on", other: "All # on" }),
        }),
      );
    }
  } else {
    const offCount = off.length;
    if (offCount <= NAMED_OFF_LIMIT) {
      // The state comes first, so a long name cannot push it past the
      // ellipsis.
      const names = off.map((server) => server.display_name).join(", ");
      parts.push(
        t({
          id: "chatInput.connectors.summary.namedOff",
          message: plural(offCount, {
            one: `Off: ${names}`,
            other: `Off: ${names}`,
          }),
        }),
      );
    } else {
      parts.push(
        t({
          id: "chatInput.connectors.summary.countsOff",
          message: `On: ${onCount}, off: ${offCount}`,
        }),
      );
    }
  }
  if (toConnectCount > 0) {
    parts.push(
      t({
        id: "chatInput.connectors.summary.toConnect",
        message: plural(toConnectCount, {
          one: "# to connect",
          other: "# to connect",
        }),
      }),
    );
  }
  if (!writeToolsEnabled) {
    parts.push(
      t({
        id: "chatInput.connectors.summary.readOnly",
        message: "read only",
      }),
    );
  }
  return parts.join(" · ");
}

/**
 * The connectors in their host-neutral form: one row that says their state
 * and opens the connectors dialog, where each one is switched, connected or
 * opened to its tools. Both composer surfaces — the mobile "+" menu and the
 * desktop tool dropdown — render this same data.
 *
 * The row carries no group header: its own label names the group, and the
 * menus separate header-less groups with a divider.
 */
export function buildMcpToolsSection({
  servers,
  disabledServerIds = [],
  writeToolsEnabled,
  onOpen,
  disabled = false,
}: McpToolsSectionOptions): AddMenuSection {
  return {
    id: MCP_TOOLS_SECTION_ID,
    // eslint-disable-next-line lingui/no-unlocalized-strings -- AddMenuSection placement enum
    placement: "belowTools",
    items: [
      {
        id: MCP_TOOLS_OPEN_ITEM_ID,
        label: t({
          id: "chatInput.connectors.open",
          message: "Connectors…",
        }),
        description: summarizeMcpConnectors({
          servers,
          disabledServerIds,
          writeToolsEnabled,
        }),
        disabled,
        closesImmediately: true,
        onSelect: onOpen,
      },
    ],
  };
}
