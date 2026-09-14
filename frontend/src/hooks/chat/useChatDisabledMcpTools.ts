import { useCallback, useMemo } from "react";

import { mcpToolPattern } from "@/utils/chat/mcpToolPatterns";

import { useChatDisabledMcpList } from "./useChatDisabledMcpList";

import type { ChatDisabledMcpList } from "./useChatDisabledMcpList";

export interface ChatDisabledMcpTools
  extends Pick<ChatDisabledMcpList, "isSaving" | "isReady" | "newChatSeed"> {
  /**
   * The `server/tool` patterns switched off; the optimistic list while a
   * save is in flight.
   */
  disabledToolPatterns: string[];
  /**
   * Flips one tool: a PUT on an existing chat, local state on a new one.
   * A no-op while `isReady` is false.
   */
  toggleTool: (serverId: string, toolName: string) => void;
}

/**
 * The per-chat list of switched-off MCP tools as the composer sees it: the
 * chat row's `disabled_mcp_tools`, read and written the way every per-chat
 * switched-off list is. Entries are exact `server/tool` names — the tool
 * browser flips one tool at a time, so nothing coarser is ever written.
 */
export function useChatDisabledMcpTools({
  chatId,
  isAvailable,
}: {
  chatId: string | null | undefined;
  /** Gates the detail fetch to composers that offer the switches at all. */
  isAvailable: boolean;
}): ChatDisabledMcpTools {
  const list = useChatDisabledMcpList({
    chatId,
    isAvailable,
    // eslint-disable-next-line lingui/no-unlocalized-strings -- chat row column
    field: "disabled_mcp_tools",
  });

  const toggleTool = useCallback(
    (serverId: string, toolName: string) =>
      list.toggle(mcpToolPattern(serverId, toolName)),
    [list],
  );

  return useMemo(
    () => ({
      disabledToolPatterns: list.disabled,
      toggleTool,
      isSaving: list.isSaving,
      isReady: list.isReady,
      newChatSeed: list.newChatSeed,
    }),
    [list, toggleTool],
  );
}
