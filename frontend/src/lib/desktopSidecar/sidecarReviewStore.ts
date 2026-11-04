import { create } from "zustand";

/**
 * The chats whose desktop sidecar calls wait for their review in the Erato
 * desktop app on this device, each with how many of its calls wait, so a
 * parent's task card can say where its task waits; and the waiting calls by
 * tool call id, so a turn parked on one can say the same. Ids only.
 */
export const useSidecarReviewStore = create<{
  waitingByChatId: ReadonlyMap<string, number>;
  waitingByToolCallId: ReadonlyMap<string, number>;
}>(() => ({ waitingByChatId: new Map(), waitingByToolCallId: new Map() }));

const counted = (
  counts: ReadonlyMap<string, number>,
  id: string | undefined,
  delta: number,
): ReadonlyMap<string, number> => {
  if (id === undefined) return counts;
  const next = new Map(counts);
  const count = (next.get(id) ?? 0) + delta;
  if (count > 0) next.set(id, count);
  else next.delete(id);
  return next;
};

const adjust = (
  chatId: string,
  toolCallId: string | undefined,
  delta: number,
) =>
  useSidecarReviewStore.setState(
    ({ waitingByChatId, waitingByToolCallId }) => ({
      waitingByChatId: counted(waitingByChatId, chatId, delta),
      waitingByToolCallId: counted(waitingByToolCallId, toolCallId, delta),
    }),
  );

/**
 * Records that one of `chatId`'s calls, `toolCallId` when known, waits for
 * its review; the returned function, safe to call more than once, records
 * that it no longer waits.
 */
export function markAwaitingReview(
  chatId: string,
  toolCallId?: string,
): () => void {
  adjust(chatId, toolCallId, 1);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    adjust(chatId, toolCallId, -1);
  };
}
