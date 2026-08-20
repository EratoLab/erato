import { plural, t } from "@lingui/core/macro";

import { Button } from "@/components/ui/Controls/Button";
import { useOpenMcpServersSettings } from "@/hooks/ui/useOpenMcpServersSettings";

import { InfoIcon } from "../icons";

interface McpNeedsAuthNoticeProps {
  /**
   * MCP server ids the generation skipped because THIS user has not completed
   * their OAuth connection. Genuinely broken servers travel in a separate
   * field and must never be routed here — their fix is not "connect".
   */
  serverIds: string[];
  /**
   * Whether to offer the "Connect" affordance. The informational text renders
   * regardless — it is part of the record of how the response was produced —
   * but the button only helps where the settings-dialog chrome watching the
   * preferences query params is mounted.
   */
  showConnect?: boolean;
}

/**
 * Quiet footnote on an assistant message whose generation skipped one or more
 * MCP servers awaiting the user's OAuth connection. Deliberately not an
 * error/alert: the response itself succeeded, the servers are healthy, and
 * connecting is optional — so this renders as muted metadata with one inline
 * affordance into the settings dialog, costing nothing to ignore.
 *
 * A server's id doubles as its display name everywhere (settings pane,
 * assistant editor) — the listing API exposes no separate label to resolve.
 */
export const McpNeedsAuthNotice = ({
  serverIds,
  showConnect = true,
}: McpNeedsAuthNoticeProps) => {
  const openMcpServersSettings = useOpenMcpServersSettings();

  if (serverIds.length === 0) {
    return null;
  }

  const serverCount = serverIds.length;
  const serverList = serverIds.join(", ");

  return (
    <div
      role="note"
      data-testid="mcp-needs-auth-notice"
      className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-theme-fg-muted"
    >
      <InfoIcon className="size-3.5 shrink-0" aria-hidden="true" />
      <span>
        {t({
          id: "chat.message.mcpNeedsAuth.text",
          message: plural(serverCount, {
            one: `${serverList} is available in this chat but not connected, so its tools were not used.`,
            other: `${serverList} are available in this chat but not connected, so their tools were not used.`,
          }),
        })}
      </span>
      {/* Same decision twice: the text stays — it is part of the record of
          the response — but the button goes wherever nothing would answer it.
          `showConnect` covers surfaces that opted out (share-link dialogs);
          the null callback covers hosts with no Router and therefore no
          settings-dialog chrome (component-kit / add-in). */}
      {showConnect && openMcpServersSettings && (
        <Button
          type="button"
          variant="link"
          size="sm"
          onClick={openMcpServersSettings}
          data-testid="mcp-needs-auth-connect"
        >
          {t({
            id: "chat.message.mcpNeedsAuth.connect",
            message: "Connect",
          })}
        </Button>
      )}
    </div>
  );
};
