import type { Message } from "@erato/frontend/library";

/**
 * Tracks which assistant messages finished streaming DURING this session.
 *
 * Auto-prompt must never fire for messages loaded from history, refetches,
 * or chat switches — only for a completion the user just watched happen. The
 * reliable signal is a status transition observed across snapshots:
 * a message we previously saw as non-`complete` (streaming messages carry
 * `status: "sending"`) that is now `complete`.
 *
 * Deliberately conservative: the very first snapshot is treated as history
 * (nothing is fresh), and a message that APPEARS already complete mid-session
 * (refetch, pagination) is not fresh either. The failure direction is
 * under-firing — a missed auto-open still leaves the buttons — never a
 * surprise window from old data.
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
    for (const id of messageOrder) {
      const message = messages[id];
      if (!message || message.role !== "assistant") {
        continue;
      }
      next.set(id, message.status);
      if (this.prevStatuses === null) {
        continue;
      }
      const sawIncomplete =
        this.prevStatuses.has(id) && this.prevStatuses.get(id) !== "complete";
      if (sawIncomplete && message.status === "complete") {
        newlyFresh.push(id);
      }
    }
    this.prevStatuses = next;
    return newlyFresh;
  }
}
