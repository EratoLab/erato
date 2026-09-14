import { useMemo } from "react";

import { useChatDisabledMcpList } from "./useChatDisabledMcpList";

import type { ChatDisabledMcpList } from "./useChatDisabledMcpList";

export interface ChatDisabledMcpServers
  extends Pick<ChatDisabledMcpList, "isSaving" | "isReady" | "newChatSeed"> {
  /** The servers switched off; the optimistic list while a save is in flight. */
  disabledServerIds: string[];
  /**
   * Flips one server: a PUT on an existing chat, local state on a new one.
   * A no-op while `isReady` is false.
   */
  toggleServer: (serverId: string) => void;
}

/**
 * The per-chat list of switched-off MCP servers as the composer sees it:
 * the chat row's `disabled_mcp_server_ids`, read and written the way every
 * per-chat switched-off list is.
 */
export function useChatDisabledMcpServers({
  chatId,
  isAvailable,
}: {
  chatId: string | null | undefined;
  /** Gates the detail fetch to composers that offer the switches at all. */
  isAvailable: boolean;
}): ChatDisabledMcpServers {
  const list = useChatDisabledMcpList({
    chatId,
    isAvailable,
    // eslint-disable-next-line lingui/no-unlocalized-strings -- chat row column
    field: "disabled_mcp_server_ids",
  });

  return useMemo(
    () => ({
      disabledServerIds: list.disabled,
      toggleServer: list.toggle,
      isSaving: list.isSaving,
      isReady: list.isReady,
      newChatSeed: list.newChatSeed,
    }),
    [list],
  );
}
