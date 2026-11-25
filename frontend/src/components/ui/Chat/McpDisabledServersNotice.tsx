import { plural, t } from "@lingui/core/macro";

import { useMcpServerDisplayName } from "@/hooks/chat/useMcpServerDisplayName";

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
 * error; unlike it there is no affordance — the remedy is the composer's
 * Connectors dialog, right below.
 *
 * Servers are named as the listing names them, falling back to the id.
 */
export const McpDisabledServersNotice = ({
  serverIds,
}: McpDisabledServersNoticeProps) =>
  // Every message mounts this; only one with servers to report subscribes.
  serverIds.length === 0 ? null : <DisabledServersNote serverIds={serverIds} />;

const DisabledServersNote = ({ serverIds }: McpDisabledServersNoticeProps) => {
  const displayName = useMcpServerDisplayName();

  const serverCount = serverIds.length;
  const serverList = serverIds.map(displayName).join(", ");

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
