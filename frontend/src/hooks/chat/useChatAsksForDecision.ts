import { useMemo } from "react";

import { useChatsInReview } from "@/lib/desktopSidecar/sidecarReviewLinks";

import {
  hasDecisionIn,
  useConfirmationRegistryStore,
} from "./store/confirmationRegistryStore";
import { useGenerationStatusStore } from "./store/generationStatusStore";

/**
 * Whether a chat asks the user something now: a confirmation card that is
 * still open, or a review in the Erato desktop app while the chat is parked on
 * it, also one that has ended and waits for the user to ask again. A chat that
 * only waits, for an app or for its tasks, does not.
 *
 * The server cannot tell a review from any other wait for an app. Only the
 * browser that opened the review knows about it, so this adds what the status
 * store cannot say, and only for a chat that is parked: a remembered review
 * says nothing about a chat that has moved on.
 */
export const useChatAsksForDecision = (chatId: string): boolean => {
  const hasCard = useConfirmationRegistryStore((state) =>
    hasDecisionIn(state, chatId),
  );
  const parked = useGenerationStatusStore(
    (state) => state.statusByChatId[chatId]?.kind === "action_required",
  );
  const inReview = useChatsInReview().has(chatId);
  return hasCard || (parked && inReview);
};

/** The same answer for a surface that aggregates many chats. */
export const useChatsAskingForDecision = (): ReadonlySet<string> => {
  const pendingIdsByChatId = useConfirmationRegistryStore(
    (state) => state.pendingIdsByChatId,
  );
  const waitingOnlyIds = useConfirmationRegistryStore(
    (state) => state.waitingOnlyIds,
  );
  const statusByChatId = useGenerationStatusStore(
    (state) => state.statusByChatId,
  );
  const inReview = useChatsInReview();
  return useMemo(() => {
    const asking = new Set<string>();
    for (const chatId of Object.keys(pendingIdsByChatId)) {
      if (hasDecisionIn({ pendingIdsByChatId, waitingOnlyIds }, chatId))
        asking.add(chatId);
    }
    for (const chatId of inReview) {
      if (statusByChatId[chatId]?.kind === "action_required")
        asking.add(chatId);
    }
    return asking;
  }, [inReview, pendingIdsByChatId, statusByChatId, waitingOnlyIds]);
};
