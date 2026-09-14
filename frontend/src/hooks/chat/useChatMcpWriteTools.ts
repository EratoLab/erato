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

const logger = createLogger("HOOK", "useChatMcpWriteTools");

export interface ChatMcpWriteTools {
  /** What the toggle row shows; the optimistic value while a save is in flight. */
  enabled: boolean;
  /** Flips the setting: a PUT on an existing chat, local state on a new one. */
  toggle: () => void;
  isSaving: boolean;
  /**
   * What the first submit of a new chat must carry: `false` once the user
   * turned writes off before the chat existed, otherwise undefined so the
   * request omits the field and the chat takes the server default. Always
   * undefined for an existing chat, where the PUT is the writer.
   */
  newChatSeed: boolean | undefined;
}

/**
 * The per-chat "allow write operations" setting as the composer sees it.
 *
 * An existing chat's value lives in its row on the server, so the hook reads
 * the chat detail and writes back through the update endpoint. Before the
 * chat exists there is no row: the value is held locally and handed to the
 * first submit, which seeds the row at creation. The local value resets
 * whenever the composer returns to a new chat.
 */
export function useChatMcpWriteTools({
  chatId,
  isAvailable,
}: {
  chatId: string | null | undefined;
  /** Gates the detail fetch to composers that offer the toggle at all. */
  isAvailable: boolean;
}): ChatMcpWriteTools {
  const queryClient = useQueryClient();
  const { data: chatDetail } = useChatDetail(
    chatId && isAvailable ? { pathParams: { chatId } } : skipToken,
    { retry: false, refetchOnWindowFocus: false },
  );
  const { mutateAsync: updateChat, isPending: isSaving } = useUpdateChat();

  const [newChatEnabled, setNewChatEnabled] = useState(true);
  // The value shown from the user's flip until the row is next fetched or
  // the flip fails; the cache is patched with the same value on success.
  const [optimisticEnabled, setOptimisticEnabled] = useState<boolean | null>(
    null,
  );

  // The local value outlives the null-to-id rename of a new chat on purpose:
  // it seeded the row, so it is the right thing to show until the row is
  // fetched. A switch between two existing chats starts from the default.
  const previousChatIdRef = useRef(chatId);
  useEffect(() => {
    const previousChatId = previousChatIdRef.current;
    previousChatIdRef.current = chatId;
    if (!chatId || previousChatId) {
      setNewChatEnabled(true);
    }
    setOptimisticEnabled(null);
  }, [chatId]);

  const enabled = chatId
    ? (optimisticEnabled ??
      chatDetail?.mcp_write_tools_enabled ??
      newChatEnabled)
    : newChatEnabled;

  const toggle = useCallback(() => {
    if (!chatId) {
      setNewChatEnabled((previous) => !previous);
      return;
    }
    const next = !enabled;
    setOptimisticEnabled(next);
    void (async () => {
      try {
        await updateChat({
          pathParams: { chatId },
          body: { mcp_write_tools_enabled: next },
        });
        queryClient.setQueryData<ChatDetail>(
          chatDetailQuery({ pathParams: { chatId } }).queryKey,
          (previous) =>
            previous
              ? { ...previous, mcp_write_tools_enabled: next }
              : previous,
        );
        // The listing rows carry the flag too, so a sidebar-driven surface
        // must not keep showing the old value.
        await queryClient.invalidateQueries({
          queryKey: recentChatsQuery({}).queryKey,
        });
      } catch (error) {
        logger.log(`Failed to update write tools for chat ${chatId}:`, error);
        setOptimisticEnabled(null);
      }
    })();
  }, [chatId, enabled, queryClient, updateChat]);

  return useMemo(
    () => ({
      enabled,
      toggle,
      isSaving,
      newChatSeed: !chatId && !newChatEnabled ? false : undefined,
    }),
    [chatId, enabled, isSaving, newChatEnabled, toggle],
  );
}
