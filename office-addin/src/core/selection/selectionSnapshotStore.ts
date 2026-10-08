import { useSyncExternalStore } from "react";

export interface SelectionRefreshRequest {
  /** The re-read counts as a user selection, so a dismissed or unarmed chip comes back. */
  rearm: boolean;
}

export interface SelectionSnapshotStore<T> {
  publish: (next: T) => void;
  getSnapshot: () => T;
  useSnapshot: () => T;
  /** Ask the single live reader to re-read now, e.g. after a host write. */
  requestRefresh: (options?: { rearm?: boolean }) => void;
  subscribeRefresh: (
    listener: (request: SelectionRefreshRequest) => void,
  ) => () => void;
  resetForTests: () => void;
}

/**
 * One live reader publishes; every other consumer reads the snapshot. Readers
 * of their own would contend for the host's selection API and disagree about
 * what is selected.
 */
export function createSelectionSnapshotStore<T>({
  empty,
  equals,
}: {
  empty: T;
  equals: (a: T, b: T) => boolean;
}): SelectionSnapshotStore<T> {
  let snapshot = empty;
  const listeners = new Set<() => void>();
  const refreshListeners = new Set<
    (request: SelectionRefreshRequest) => void
  >();

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function getSnapshot(): T {
    return snapshot;
  }

  return {
    publish(next) {
      if (equals(next, snapshot)) return;
      snapshot = next;
      for (const listener of listeners) {
        listener();
      }
    },
    getSnapshot,
    useSnapshot() {
      return useSyncExternalStore(subscribe, getSnapshot);
    },
    requestRefresh(options) {
      const request = { rearm: options?.rearm ?? false };
      for (const listener of refreshListeners) {
        listener(request);
      }
    },
    subscribeRefresh(listener) {
      refreshListeners.add(listener);
      return () => {
        refreshListeners.delete(listener);
      };
    },
    resetForTests() {
      snapshot = empty;
      listeners.clear();
      refreshListeners.clear();
    },
  };
}
