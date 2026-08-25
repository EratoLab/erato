import { useMemo } from "react";

import { useConfirmationRegistryStore } from "@/hooks/chat/store/confirmationRegistryStore";
import { useGenerationStatusStore } from "@/hooks/chat/store/generationStatusStore";
import { useMessagingStore } from "@/hooks/chat/store/messagingStore";

/**
 * How many chats away from the user's eye want it: running, finished/error
 * the session observed, and chats awaiting a tool decision. The last come
 * from two channels — the mount-driven confirmation registry (the open chat)
 * and the server-seeded status store (everything else) — deduplicated by
 * chat id.
 *
 * Shared so every surface that aggregates the same signal counts it the same
 * way: the web sidebar's rail badge and the add-in pane's drawer trigger,
 * neither of which can show the per-row dots while collapsed or closed.
 *
 * The chat in view is deliberately excluded, matching the status store's own
 * policy that "the chat in view never carries an attention marker": a local
 * send seeds the open chat as running, and counting it would announce the
 * conversation already filling the screen. A pending tool approval is the one
 * exception — an open chat parked on a decision is still asking for one.
 *
 * The viewed chat is two ids, not one: a first turn streams before its chat
 * id is adopted, so the status store's `currentChatId` is still null while
 * the messaging store already knows the created id. Counting only the former
 * would leave a first turn's terminal outcome stuck on the badge.
 */
export const useGenerationIndicatorCount = (): number => {
  const statusByChatId = useGenerationStatusStore(
    (state) => state.statusByChatId,
  );
  const currentChatId = useGenerationStatusStore(
    (state) => state.currentChatId,
  );
  const newlyCreatedChatId = useMessagingStore(
    (state) => state.newlyCreatedChatId,
  );
  const pendingIdsByChatId = useConfirmationRegistryStore(
    (state) => state.pendingIdsByChatId,
  );

  return useMemo(() => {
    const inView = new Set(
      [currentChatId, newlyCreatedChatId].filter(
        (chatId): chatId is string => chatId !== null,
      ),
    );
    const actionRequiredChatIds = new Set(Object.keys(pendingIdsByChatId));
    let count = 0;
    for (const [chatId, status] of Object.entries(statusByChatId)) {
      if (status?.kind === "action_required") {
        actionRequiredChatIds.add(chatId);
        continue;
      }
      if (inView.has(chatId)) {
        continue;
      }
      if (
        status?.kind === "running" ||
        status?.kind === "finished" ||
        status?.kind === "error"
      ) {
        count += 1;
      }
    }
    return count + actionRequiredChatIds.size;
  }, [currentChatId, newlyCreatedChatId, pendingIdsByChatId, statusByChatId]);
};
