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

export function resetComposeSelectionStoreForTests(): void {
  snapshot = EMPTY;
  listeners.clear();
}
