import { useSyncExternalStore } from "react";

/**
 * The chip's (x)/(+) per conversation, in memory only like Word's: Office settings would be saved
 * into the file. A conversation without a choice includes the presentation.
 */
let overrides: ReadonlyMap<string, boolean> = new Map();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => overrides;

export const POWERPOINT_INCLUDE_BY_DEFAULT = true;

export const powerpointInclusionStore = {
  isIncluded(conversationKey: string): boolean {
    return overrides.get(conversationKey) ?? POWERPOINT_INCLUDE_BY_DEFAULT;
  },
  useIncluded(conversationKey: string): boolean {
    return (
      useSyncExternalStore(subscribe, getSnapshot).get(conversationKey) ??
      POWERPOINT_INCLUDE_BY_DEFAULT
    );
  },
  setIncluded(conversationKey: string, included: boolean) {
    if (overrides.get(conversationKey) === included) return;
    const next = new Map(overrides);
    next.set(conversationKey, included);
    overrides = next;
    for (const listener of listeners) listener();
  },
  resetForTests() {
    overrides = new Map();
    listeners.clear();
  },
};
