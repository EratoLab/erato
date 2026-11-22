import { useRef, useSyncExternalStore } from "react";

export interface ValueStore<T> {
  get: () => T;
  subscribe: (listener: () => void) => () => void;
}

export interface WritableValueStore<T> extends ValueStore<T> {
  set: (next: T) => void;
}

export function createValueStore<T>(initial: T): WritableValueStore<T> {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set(next) {
      if (Object.is(next, current)) return;
      current = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The store's value; re-renders whenever it is replaced. */
export function useValueStore<T>(store: ValueStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.get);
}

/**
 * A value derived from a store; re-renders only when `isEqual` says the
 * derived value changed.
 */
export function useValueStoreSelector<S, T>(
  store: ValueStore<S>,
  select: (value: S) => T,
  isEqual: (previous: T, next: T) => boolean,
): T {
  const last = useRef<{
    source: S;
    select: (value: S) => T;
    value: T;
  } | null>(null);
  return useSyncExternalStore(store.subscribe, () => {
    const source = store.get();
    const cached = last.current;
    if (cached && Object.is(cached.source, source) && cached.select === select)
      return cached.value;
    const next = select(source);
    const value = cached && isEqual(cached.value, next) ? cached.value : next;
    last.current = { source, select, value };
    return value;
  });
}
