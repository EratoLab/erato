import { useMemo } from "react";

import { useGenerationStatusStore } from "@/hooks/chat/store/generationStatusStore";
import { useMessagingStore } from "@/hooks/chat/store/messagingStore";

import { useChatsAskingForDecision } from "./useChatAsksForDecision";

/**
 * How many chats away from the user's eye want it: running, finished/error
 * the session observed, and chats awaiting a decision. The last come from
 * three channels — the mount-driven confirmation registry (the open chat),
 * the server-seeded status store (everything else) and the reviews open in
 * this browser — deduplicated by chat id. A chat that only waits, for an app
 * or for its tasks, asks for nothing and is not counted.
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
  const asking = useChatsAskingForDecision();

  return useMemo(() => {
    const inView = new Set(
      [currentChatId, newlyCreatedChatId].filter(
        (chatId): chatId is string => chatId !== null,
      ),
    );
    const actionRequiredChatIds = new Set(asking);
    let count = 0;
    for (const [chatId, status] of Object.entries(statusByChatId)) {
      if (status?.kind === "action_required") {
        if (status.waitingOnly !== true) actionRequiredChatIds.add(chatId);
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
  }, [asking, currentChatId, newlyCreatedChatId, statusByChatId]);
};
