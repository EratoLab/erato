import { skipToken, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  chatDetailQuery,
  recentChatsQuery,
  useChatDetail,
  useUpdateChat,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { createLogger } from "@/utils/debugLogger";

import type { ChatDetail } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const logger = createLogger("HOOK", "useChatDisabledMcpServers");

const EMPTY: string[] = [];

export interface ChatDisabledMcpServers {
  /** The servers switched off; the optimistic list while a save is in flight. */
  disabledServerIds: string[];
  /** Flips one server: a PUT on an existing chat, local state on a new one. */
  toggleServer: (serverId: string) => void;
  isSaving: boolean;
  /**
   * What the first submit of a new chat must carry: the list once the user
   * switched a server off before the chat existed, otherwise undefined so
   * the request omits the field and the chat takes the server default.
   * Always undefined for an existing chat, where the PUT is the writer.
   */
  newChatSeed: string[] | undefined;
}

const toggled = (ids: string[], serverId: string) =>
  ids.includes(serverId)
    ? ids.filter((id) => id !== serverId)
    : [...ids, serverId];

/**
 * The per-chat list of switched-off MCP servers as the composer sees it.
 *
 * Same shape as the write switch: an existing chat's list lives in its row
 * on the server, so the hook reads the chat detail and writes the whole
 * replacement list back through the update endpoint. Before the chat exists
 * there is no row: the list is held locally and handed to the first submit,
 * which seeds the row at creation. The local list resets whenever the
 * composer returns to a new chat.
 */
export function useChatDisabledMcpServers({
  chatId,
  isAvailable,
}: {
  chatId: string | null | undefined;
  /** Gates the detail fetch to composers that offer the switches at all. */
  isAvailable: boolean;
}): ChatDisabledMcpServers {
  const queryClient = useQueryClient();
  const { data: chatDetail } = useChatDetail(
    chatId && isAvailable ? { pathParams: { chatId } } : skipToken,
    { retry: false, refetchOnWindowFocus: false },
  );
  const { mutateAsync: updateChat, isPending: isSaving } = useUpdateChat();

  const [newChatDisabledIds, setNewChatDisabledIds] = useState<string[]>(EMPTY);
  // The list shown from the user's flip until the row is next fetched or the
  // flip fails; the cache is patched with the same list on success.
  const [optimisticDisabledIds, setOptimisticDisabledIds] = useState<
    string[] | null
  >(null);

  // The local list outlives the null-to-id rename of a new chat on purpose:
  // it seeded the row, so it is the right thing to show until the row is
  // fetched. A switch between two existing chats starts from the default.
  const previousChatIdRef = useRef(chatId);
  useEffect(() => {
    const previousChatId = previousChatIdRef.current;
    previousChatIdRef.current = chatId;
    if (!chatId || previousChatId) {
      setNewChatDisabledIds(EMPTY);
    }
    setOptimisticDisabledIds(null);
  }, [chatId]);

  const disabledServerIds = chatId
    ? (optimisticDisabledIds ??
      chatDetail?.disabled_mcp_server_ids ??
      newChatDisabledIds)
    : newChatDisabledIds;

  const toggleServer = useCallback(
    (serverId: string) => {
      if (!chatId) {
        setNewChatDisabledIds((previous) => toggled(previous, serverId));
        return;
      }
      const next = toggled(disabledServerIds, serverId);
      setOptimisticDisabledIds(next);
      void (async () => {
        try {
          await updateChat({
            pathParams: { chatId },
            body: { disabled_mcp_server_ids: next },
          });
          queryClient.setQueryData<ChatDetail>(
            chatDetailQuery({ pathParams: { chatId } }).queryKey,
            (previous) =>
              previous
                ? { ...previous, disabled_mcp_server_ids: next }
                : previous,
          );
          // The listing rows carry the list too, so a sidebar-driven surface
          // must not keep showing the old value.
          await queryClient.invalidateQueries({
            queryKey: recentChatsQuery({}).queryKey,
          });
        } catch (error) {
          logger.log(
            `Failed to update disabled MCP servers for chat ${chatId}:`,
            error,
          );
          setOptimisticDisabledIds(null);
        }
      })();
    },
    [chatId, disabledServerIds, queryClient, updateChat],
  );

  return useMemo(
    () => ({
      disabledServerIds,
      toggleServer,
      isSaving,
      newChatSeed:
        !chatId && newChatDisabledIds.length > 0
          ? newChatDisabledIds
          : undefined,
    }),
    [chatId, disabledServerIds, isSaving, newChatDisabledIds, toggleServer],
  );
}
