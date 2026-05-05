import { useCallback, useDebugValue, useSyncExternalStore } from "react";

export interface PersistedStateOptions<T> {
  /**
   * Validate / coerce a parsed value into `T`. Return `null` to reject the
   * stored value and fall back to `defaultValue`. Throwing also rejects.
   */
  parse: (value: unknown) => T | null;
  /** Defaults to `JSON.stringify`. Override for custom encoding. */
  serialize?: (value: T) => string;
}

const subscribers = new Map<string, Set<() => void>>();

function subscribe(key: string, listener: () => void) {
  let listeners = subscribers.get(key);
  if (!listeners) {
    listeners = new Set();
    subscribers.set(key, listeners);
  }
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      subscribers.delete(key);
    }
  };
}

function notify(key: string) {
  subscribers.get(key)?.forEach((listener) => listener());
}

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string | null) {
  try {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch {
    // Best-effort: swallow quota / availability errors. State still updates
    // in-memory for the current session.
  }
}

function readValue<T>(
  key: string,
  options: PersistedStateOptions<T>,
): T | null {
  const raw = readRaw(key);
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  try {
    return options.parse(parsed);
  } catch {
    return null;
  }
}

const snapshotCache = new Map<string, { raw: string | null; value: unknown }>();

function getSnapshot<T>(
  key: string,
  options: PersistedStateOptions<T>,
): T | null {
  const raw = readRaw(key);
  const cached = snapshotCache.get(key);
  if (cached && cached.raw === raw) {
    return cached.value as T | null;
  }
  const value = readValue(key, options);
  snapshotCache.set(key, { raw, value });
  return value;
}

/**
 * Like `useState`, but persisted to `localStorage` under `key` and synchronised
 * across all consumers in the current tab.
 *
 * Reads are synchronous and happen during render via `useSyncExternalStore`,
 * which is the React 19 idiomatic way to bridge a mutable external store
 * without tearing.
 *
 * `defaultValue` is returned whenever the stored value is missing or fails
 * `options.parse`. Pass `null` to clear.
 */
export function usePersistedState<T>(
  key: string,
  defaultValue: T,
  options: PersistedStateOptions<T>,
): [T, (next: T | ((previous: T) => T) | null) => void] {
  const subscribeForKey = useCallback(
    (listener: () => void) => subscribe(key, listener),
    [key],
  );

  const value = useSyncExternalStore(
    subscribeForKey,
    () => getSnapshot(key, options) ?? defaultValue,
    () => defaultValue,
  );

  const setValue = useCallback(
    (next: T | ((previous: T) => T) | null) => {
      const previous = getSnapshot(key, options) ?? defaultValue;
      const resolved =
        typeof next === "function"
          ? (next as (previous: T) => T)(previous)
          : next;
      if (resolved === null) {
        writeRaw(key, null);
      } else {
        const serialize = options.serialize ?? JSON.stringify;
        writeRaw(key, serialize(resolved));
      }
      snapshotCache.delete(key);
      notify(key);
    },
    [key, defaultValue, options],
  );

  useDebugValue(value);

  return [value, setValue];
}
