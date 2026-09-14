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

const logger = createLogger("HOOK", "useChatDisabledMcpList");

const EMPTY: string[] = [];

/** The chat-row lists the composer switches entries in and out of. */
export type ChatDisabledMcpListField =
  | "disabled_mcp_server_ids"
  | "disabled_mcp_tools";

export interface ChatDisabledMcpList {
  /** The entries switched off; the optimistic list while a save is in flight. */
  disabled: string[];
  /**
   * Flips one entry: a PUT on an existing chat, local state on a new one.
   * A no-op while `isReady` is false.
   */
  toggle: (entry: string) => void;
  isSaving: boolean;
  /**
   * False while an existing chat's row has not been read yet. The PUT
   * replaces the whole list, so a flip computed from any other base would
   * silently re-enable the entries the row already holds; the switches stay
   * locked until the row is in.
   */
  isReady: boolean;
  /**
   * What the first submit of a new chat must carry: the list once the user
   * switched an entry off before the chat existed, otherwise undefined so
   * the request omits the field and the chat takes the server default.
   * Always undefined for an existing chat, where the PUT is the writer.
   */
  newChatSeed: string[] | undefined;
}

const toggled = (entries: string[], entry: string) =>
  entries.includes(entry)
    ? entries.filter((candidate) => candidate !== entry)
    : [...entries, entry];

/**
 * One per-chat switched-off list as the composer sees it, for whichever
 * column `field` names; the server and tool hooks are this with a name.
 *
 * Same shape as the write switch: an existing chat's list lives in its row
 * on the server, so the hook reads the chat detail and writes the whole
 * replacement list back through the update endpoint. Before the chat exists
 * there is no row: the list is held locally and handed to the first submit,
 * which seeds the row at creation. The local list resets whenever the
 * composer returns to a new chat.
 */
export function useChatDisabledMcpList({
  chatId,
  isAvailable,
  field,
}: {
  chatId: string | null | undefined;
  /** Gates the detail fetch to composers that offer the switches at all. */
  isAvailable: boolean;
  field: ChatDisabledMcpListField;
}): ChatDisabledMcpList {
  const queryClient = useQueryClient();
  const { data: chatDetail } = useChatDetail(
    chatId && isAvailable ? { pathParams: { chatId } } : skipToken,
    { retry: false, refetchOnWindowFocus: false },
  );
  const { mutateAsync: updateChat, isPending: isSaving } = useUpdateChat();

  const [newChatDisabled, setNewChatDisabled] = useState<string[]>(EMPTY);
  // The list shown from the user's flip until the row is next fetched or the
  // flip fails; the cache is patched with the same list on success.
  const [optimisticDisabled, setOptimisticDisabled] = useState<string[] | null>(
    null,
  );

  // The local list outlives the null-to-id rename of a new chat on purpose:
  // it seeded the row, so it is the right thing to show until the row is
  // fetched. A switch between two existing chats starts from the default.
  const previousChatIdRef = useRef(chatId);
  useEffect(() => {
    const previousChatId = previousChatIdRef.current;
    previousChatIdRef.current = chatId;
    if (!chatId || previousChatId) {
      setNewChatDisabled(EMPTY);
    }
    setOptimisticDisabled(null);
  }, [chatId]);

  // The row's list is the only base a replacement may be built from; the
  // local list is shown across the rename but never written back.
  const rowDisabled = chatId
    ? (optimisticDisabled ?? chatDetail?.[field])
    : undefined;
  const isReady = !chatId || rowDisabled !== undefined;
  const disabled = rowDisabled ?? newChatDisabled;

  const toggle = useCallback(
    (entry: string) => {
      if (!chatId) {
        setNewChatDisabled((previous) => toggled(previous, entry));
        return;
      }
      if (rowDisabled === undefined) {
        return;
      }
      const next = toggled(rowDisabled, entry);
      setOptimisticDisabled(next);
      void (async () => {
        try {
          await updateChat({
            pathParams: { chatId },
            body: { [field]: next },
          });
          queryClient.setQueryData<ChatDetail>(
            chatDetailQuery({ pathParams: { chatId } }).queryKey,
            (previous) =>
              previous ? { ...previous, [field]: next } : previous,
          );
          // The listing rows carry the list too, so a sidebar-driven surface
          // must not keep showing the old value.
          await queryClient.invalidateQueries({
            queryKey: recentChatsQuery({}).queryKey,
          });
        } catch (error) {
          logger.log(`Failed to update ${field} for chat ${chatId}:`, error);
          setOptimisticDisabled(null);
        }
      })();
    },
    [chatId, field, queryClient, rowDisabled, updateChat],
  );

  return useMemo(
    () => ({
      disabled,
      toggle,
      isSaving,
      isReady,
      newChatSeed:
        !chatId && newChatDisabled.length > 0 ? newChatDisabled : undefined,
    }),
    [chatId, disabled, isReady, isSaving, newChatDisabled, toggle],
  );
}
