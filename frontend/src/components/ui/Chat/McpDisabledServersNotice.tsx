import { plural, t } from "@lingui/core/macro";

import { InfoIcon } from "../icons";

interface McpDisabledServersNoticeProps {
  /** MCP server ids whose tools the generation withheld because the user
   * switched the server off for this chat. */
  serverIds: string[];
}

/**
 * Quiet footnote on an assistant message whose generation withheld one or
 * more MCP servers the user switched off for the chat. Like the needs-auth
 * note it is part of the record of how the response was produced, not an
 * error; unlike it there is no affordance — the remedy is the connectors
 * switch in the composer, right below.
 *
 * A server's id doubles as its display name everywhere (settings pane,
 * composer rows) — the listing API exposes no separate label to resolve.
 */
export const McpDisabledServersNotice = ({
  serverIds,
}: McpDisabledServersNoticeProps) => {
  if (serverIds.length === 0) {
    return null;
  }

  const serverCount = serverIds.length;
  const serverList = serverIds.join(", ");

  return (
    <div
      role="note"
      data-testid="mcp-disabled-servers-notice"
      className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-theme-fg-muted"
    >
      <InfoIcon className="size-3.5 shrink-0" aria-hidden="true" />
      <span>
        {t({
          id: "chat.message.mcpDisabledServers.text",
          message: plural(serverCount, {
            one: `${serverList} is switched off for this chat, so its tools were not used.`,
            other: `${serverList} are switched off for this chat, so their tools were not used.`,
          }),
        })}
      </span>
    </div>
  );
};
