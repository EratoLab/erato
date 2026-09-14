import { plural, t } from "@lingui/core/macro";

import { InfoIcon } from "../icons";

interface McpDisabledToolsNoticeProps {
  /** `server/tool` names the generation withheld because the user switched
   * the single tool off for this chat. */
  toolNames: string[];
}

/**
 * Quiet footnote on an assistant message whose generation withheld one or
 * more single MCP tools the user switched off for the chat — the sibling
 * of the switched-off servers note, for the finer switch in the tool
 * browser. Part of the record of how the response was produced, not an
 * error, and without an affordance: the remedy is the browser behind the
 * composer's connectors row.
 *
 * The names are shown in their `server/tool` spelling: it is what the
 * browser lists, and the server half is what tells two same-named tools
 * apart.
 */
export const McpDisabledToolsNotice = ({
  toolNames,
}: McpDisabledToolsNoticeProps) => {
  if (toolNames.length === 0) {
    return null;
  }

  const toolCount = toolNames.length;
  const toolList = toolNames.join(", ");

  return (
    <div
      role="note"
      data-testid="mcp-disabled-tools-notice"
      className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-theme-fg-muted"
    >
      <InfoIcon className="size-3.5 shrink-0" aria-hidden="true" />
      <span>
        {t({
          id: "chat.message.mcpDisabledTools.text",
          message: plural(toolCount, {
            one: `The tool ${toolList} is switched off for this chat, so it was not used.`,
            other: `The tools ${toolList} are switched off for this chat, so they were not used.`,
          }),
        })}
      </span>
    </div>
  );
};
