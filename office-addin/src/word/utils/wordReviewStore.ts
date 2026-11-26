import { useCallback, useSyncExternalStore } from "react";

import type { WordApplyStage } from "./wordApplyProgress";

/**
 * The stage of each running apply, by review key. A card reads only its own, so an apply's
 * progress redraws the card it belongs to, not every Word card of the chat.
 */
export interface WordApplyProgressStore {
  get: (key: string) => WordApplyStage | undefined;
  set: (key: string, stage: WordApplyStage | undefined) => void;
  subscribe: (key: string, listener: () => void) => () => void;
}

export function createWordApplyProgressStore(): WordApplyProgressStore {
  const stages = new Map<string, WordApplyStage>();
  const listeners = new Map<string, Set<() => void>>();
  return {
    get: (key) => stages.get(key),
    set: (key, stage) => {
      if (stages.get(key) === stage) return;
      if (stage === undefined) stages.delete(key);
      else stages.set(key, stage);
      for (const listener of [...(listeners.get(key) ?? [])]) listener();
    },
    subscribe: (key, listener) => {
      const forKey = listeners.get(key) ?? new Set();
      forKey.add(listener);
      listeners.set(key, forKey);
      return () => {
        forKey.delete(listener);
        if (!forKey.size) listeners.delete(key);
      };
    },
  };
}

export function useWordApplyStageFrom(
  store: WordApplyProgressStore,
  key: string,
): WordApplyStage | undefined {
  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(key, listener),
    [store, key],
  );
  const read = useCallback(() => store.get(key), [store, key]);
  return useSyncExternalStore(subscribe, read, read);
}
