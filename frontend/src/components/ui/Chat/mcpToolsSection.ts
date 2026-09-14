import { t } from "@lingui/core/macro";

import type { AddMenuSection } from "./ChatInputAddMenu";

export const MCP_TOOLS_SECTION_ID = "mcp-tools";
export const MCP_TOOLS_WRITE_TOGGLE_ITEM_ID = "allow-write-operations";
export const MCP_TOOLS_BROWSE_ITEM_ID = "browse-tools";

interface McpToolsSectionOptions {
  /** The chat's current write setting; the toggle row shows it as checked. */
  writeToolsEnabled: boolean;
  onToggleWriteTools: () => void;
  onBrowse: () => void;
  disabled?: boolean;
  /**
   * Whether this host also proposes actions of its own — the Outlook add-in
   * sends its action facet with every request — so the toggle's description
   * names that those pause too. Copy only; the switch itself is one control.
   */
  pausesHostActions?: boolean;
}

/**
 * The "Connectors" group in its host-neutral form: the per-chat write switch
 * and the row into the tool browser. Both composer surfaces — the mobile "+"
 * menu and the desktop tool dropdown — render this same data.
 *
 * The description deliberately says "tools the server marks read-only":
 * under protocol defaults an unannotated tool is not read-only, so with
 * writes off it disappears too, and "read-only tools" would misdescribe that.
 */
export function buildMcpToolsSection({
  writeToolsEnabled,
  onToggleWriteTools,
  onBrowse,
  disabled = false,
  pausesHostActions = false,
}: McpToolsSectionOptions): AddMenuSection {
  return {
    id: MCP_TOOLS_SECTION_ID,
    header: t({
      id: "chatInput.connectors.sectionHeader",
      message: "Connectors",
    }),
    // eslint-disable-next-line lingui/no-unlocalized-strings -- AddMenuSection placement enum
    placement: "belowTools",
    items: [
      {
        id: MCP_TOOLS_WRITE_TOGGLE_ITEM_ID,
        label: t({
          id: "chatInput.connectors.allowWrites.label",
          message: "Allow write operations",
        }),
        description: pausesHostActions
          ? t({
              id: "chatInput.connectors.allowWrites.descriptionWithHostActions",
              message:
                "Off, only tools the server marks read-only are offered. Also pauses Outlook actions like Reply and Send.",
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
