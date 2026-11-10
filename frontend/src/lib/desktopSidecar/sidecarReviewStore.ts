import { create } from "zustand";

/**
 * The chats whose desktop sidecar calls wait for their review in the Erato
 * desktop app on this device, each with how many of its calls wait, so a
 * parent's task card can say where its task waits, and a chat whose row still
 * names a call that has ended can say one of its calls is in review. Which
 * call that is comes from the row and `sidecarReviewLinks`. Ids only.
 */
export const useSidecarReviewStore = create<{
  waitingByChatId: ReadonlyMap<string, number>;
}>(() => ({ waitingByChatId: new Map() }));

const adjust = (chatId: string, delta: number) =>
  useSidecarReviewStore.setState(({ waitingByChatId }) => {
    const next = new Map(waitingByChatId);
    const count = (next.get(chatId) ?? 0) + delta;
    if (count > 0) next.set(chatId, count);
    else next.delete(chatId);
    return { waitingByChatId: next };
  });

/**
 * Records that one of `chatId`'s calls waits for its review; the returned
 * function, safe to call more than once, records that it no longer waits.
 */
export function markAwaitingReview(chatId: string): () => void {
  adjust(chatId, 1);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    adjust(chatId, -1);
  };
}
