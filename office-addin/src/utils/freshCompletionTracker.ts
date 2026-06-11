import type { Message } from "@erato/frontend/library";

/**
 * Tracks which assistant messages finished streaming DURING this session.
 *
 * Auto-prompt must never fire for messages loaded from history, refetches,
 * or chat switches — only for a completion the user just watched happen.
 *
 * Two signals mark a message fresh:
 *
 * 1. Transition: a message previously observed as non-`complete` (streaming
 *    messages carry `status: "sending"`) that is now `complete`.
 * 2. Replacement: very short responses (or buffering proxies) can deliver
 *    `assistant_message_started` and the completion in one network chunk, so
 *    the optimistic placeholder id is swapped for the real id with no
 *    intermediate `sending` render. That snapshot shows: a tracked
 *    non-complete id disappeared, exactly ONE new id appeared already
 *    `complete`, and every previously-tracked complete id is still present
 *    (ruling out chat switches and list replacements).
 *
 * Deliberately conservative beyond that: the first snapshot is history
 * (nothing fresh), and a message that merely APPEARS complete mid-session
 * (refetch, pagination) is not fresh. The failure direction is under-firing —
 * a missed auto-open still leaves the buttons — never a surprise window from
 * old data. The owner must additionally discard the tracker on chat switches
 * (see AddinChat), which removes the residual cross-chat ambiguity.
 */
export class FreshCompletionTracker {
  private prevStatuses: Map<string, string | undefined> | null = null;

  /** Observe the current snapshot; returns ids that JUST completed. */
  observe(
    messages: Record<string, Message>,
    messageOrder: readonly string[],
  ): string[] {
    const next = new Map<string, string | undefined>();
    const newlyFresh: string[] = [];
    const appearedComplete: string[] = [];
    for (const id of messageOrder) {
      const message = messages[id];
      if (!message || message.role !== "assistant") {
        continue;
      }
      next.set(id, message.status);
      if (this.prevStatuses === null) {
        continue;
      }
      if (this.prevStatuses.has(id)) {
        const sawIncomplete = this.prevStatuses.get(id) !== "complete";
        if (sawIncomplete && message.status === "complete") {
          newlyFresh.push(id);
        }
      } else if (message.status === "complete") {
        appearedComplete.push(id);
      }
    }
    if (this.prevStatuses !== null && appearedComplete.length === 1) {
      let incompleteDisappeared = false;
      let allCompleteRetained = true;
      for (const [id, status] of this.prevStatuses) {
        if (next.has(id)) {
          continue;
        }
        if (status === "complete") {
          allCompleteRetained = false;
        } else {
          incompleteDisappeared = true;
        }
      }
      if (incompleteDisappeared && allCompleteRetained) {
        newlyFresh.push(appearedComplete[0]);
      }
    }
    this.prevStatuses = next;
    return newlyFresh;
  }
}
