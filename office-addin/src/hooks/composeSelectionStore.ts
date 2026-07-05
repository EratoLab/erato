import { useSyncExternalStore } from "react";

import type { OutlookComposeSelection } from "./useOutlookComposeSelection";

/**
 * Shared snapshot of the compose selection, published by the SINGLE polling
 * `useOutlookComposeSelection` instance (mounted in `AddinChatInput`, which is
 * always present on the chat surface) and consumed by everything else via
 * {@link useComposeSelectionSnapshot}.
 *
 * Why not just call the polling hook everywhere: each instance runs its OWN
 * poll loop with its own ERMAIN-431 adaptations (in-flight guard, Html-
 * coercion switch). Multiple instances fight over the host's serialized
 * item-API slot, and each re-learns the Text-coercion hang separately — the
 * chip healed while every email card's "Replace Selection" stayed blind.
 */

const EMPTY: OutlookComposeSelection = { data: "", sourceProperty: "body" };

let snapshot: OutlookComposeSelection = EMPTY;
const listeners = new Set<() => void>();

export function publishComposeSelection(next: OutlookComposeSelection): void {
  if (
    next.data === snapshot.data &&
    next.sourceProperty === snapshot.sourceProperty
  ) {
    return;
  }
  snapshot = next;
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): OutlookComposeSelection {
  return snapshot;
}

/** The current compose selection, without running a poller of your own. */
export function useComposeSelectionSnapshot(): OutlookComposeSelection {
  return useSyncExternalStore(subscribe, getSnapshot);
}

// --- Polling coordination (ERMAIN-431) ---
// A compose WRITE (`setSelectedDataAsync`, the insert/replace path) locks the
// host's single serialized item-API slot while it re-tokenizes the body; a
// selection poll issued in that window contends (5100/5001) and — worse — the
// write is invisible to the poll's own in-flight guard, so the poll can wait
// out its whole stuck-call budget on a slot the INSERT is holding. Callers
// pause polling around a write and request one immediate poll on completion,
// so a post-insert re-selection is reflected without waiting for the next
// interval. Depth-counted so overlapping writes stay balanced.
let pauseDepth = 0;
const immediatePollListeners = new Set<() => void>();

export function pauseComposeSelectionPolling(): void {
  pauseDepth += 1;
}

export function resumeComposeSelectionPolling(): void {
  pauseDepth = Math.max(0, pauseDepth - 1);
}

export function isComposeSelectionPollingPaused(): boolean {
  return pauseDepth > 0;
}

/** Ask the live poller to run one poll now (e.g. right after a compose write). */
export function requestImmediateComposeSelectionPoll(): void {
  for (const listener of immediatePollListeners) {
    listener();
  }
}

export function subscribeImmediateComposeSelectionPoll(
  listener: () => void,
): () => void {
  immediatePollListeners.add(listener);
  return () => {
    immediatePollListeners.delete(listener);
  };
}

export function resetComposeSelectionStoreForTests(): void {
  snapshot = EMPTY;
  listeners.clear();
  pauseDepth = 0;
  immediatePollListeners.clear();
}
