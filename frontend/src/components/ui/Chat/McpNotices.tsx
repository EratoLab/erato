import { McpDisabledServersNotice } from "./McpDisabledServersNotice";
import { McpDisabledToolsNotice } from "./McpDisabledToolsNotice";
import { McpNeedsAuthNotice } from "./McpNeedsAuthNotice";

import type { UiChatMessage } from "@/utils/adapters/messageAdapter";

interface McpNoticesProps {
  /** The message whose generation metadata the footnotes report on. */
  message: UiChatMessage;
  /**
   * Whether the needs-auth footnote may offer its "Connect" affordance. Pass
   * `false` on a surface without the settings-dialog chrome; leave it unset to
   * let the notice decide.
   */
  showConnect?: boolean;
}

/**
 * Every MCP footnote a message can carry, in one component so that no renderer
 * — the host's own or a component kit's `ChatMessageRenderer` override — has to
 * re-derive the needing-auth-minus-switched-off exclusion below and drift from
 * it. Each notice returns `null` on an empty list, so this renders nothing for
 * the ordinary message.
 *
 * Only the assistant message of the affected generation carries this metadata,
 * so absence costs nothing here. Deliberately keyed off needing-auth alone:
 * unavailable servers have no user-side remedy, so they must not raise a
 * connect affordance.
 *
 * The text renders on every surface — it is part of the record of the response
 * — but the Connect button needs the settings-dialog chrome that watches the
 * preferences query params, which share-link pages do not mount, hence the
 * flag. Routerless hosts (component-kit / add-in) are handled by the notice
 * itself, which drops the button when its settings hook reports no Router.
 *
 * A server the user switched off is still probed before it is withheld, so it
 * can sit in both lists; the switch-off is the reason the user chose, so it is
 * the one reported.
 */
export const McpNotices = ({ message, showConnect }: McpNoticesProps) => {
  const serversDisabledByUser = message.mcp_servers_disabled_by_user ?? [];
  const serversNeedingAuth = (message.mcp_servers_needing_auth ?? []).filter(
    (serverId) => !serversDisabledByUser.includes(serverId),
  );

  return (
    <>
      <McpDisabledServersNotice serverIds={serversDisabledByUser} />
      <McpDisabledToolsNotice
        toolNames={message.mcp_tools_disabled_by_user ?? []}
      />
      <McpNeedsAuthNotice
        serverIds={serversNeedingAuth}
        showConnect={showConnect}
      />
    </>
  );
};
