import { useCallback, useDebugValue, useSyncExternalStore } from "react";

export interface PersistedStateOptions<T> {
  /**
   * Schema version. Bump when the stored shape changes; existing values that
   * fail `parse` (or whose stored version differs from `version`) are dropped
   * unless `migrate` rescues them.
   */
  version: number;
  /**
   * Validate / coerce a parsed value into `T`. Return `null` to reject the
   * stored value and fall back to `defaultValue`. Throwing also rejects.
   */
  parse: (value: unknown) => T | null;
  /**
   * Optional migration from a previous version's value. Called when a stored
   * envelope's `version` differs from `version`. Return the migrated value, or
   * `null` to drop the stored value.
   */
  migrate?: (priorValue: unknown, priorVersion: number | null) => T | null;
  /** Defaults to `JSON.stringify`. Override for custom encoding. */
  serialize?: (value: T) => string;
}

interface Envelope<T> {
  v: number;
  d: T;
}

const subscribers = new Map<string, Set<() => void>>();

function subscribe(key: string, listener: () => void) {
  let listeners = subscribers.get(key);
  if (!listeners) {
    listeners = new Set();
    subscribers.set(key, listeners);
  }
  listeners.add(listener);

  const onStorage = (event: StorageEvent) => {
    if (event.storageArea === localStorage && event.key === key) {
      listener();
    }
  };
  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      subscribers.delete(key);
    }
    window.removeEventListener("storage", onStorage);
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

function readEnvelope<T>(
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

  if (
    parsed !== null &&
    typeof parsed === "object" &&
    "v" in parsed &&
    "d" in parsed
  ) {
    const envelope = parsed as Envelope<unknown>;
    if (envelope.v === options.version) {
      try {
        return options.parse(envelope.d);
      } catch {
        return null;
      }
    }
    if (options.migrate) {
      try {
        return options.migrate(envelope.d, envelope.v);
      } catch {
        return null;
      }
    }
    return null;
  }

  // Legacy / un-enveloped value. Hand it to migrate(_, null) so callers can
  // rescue pre-versioned schemas.
  if (options.migrate) {
    try {
      return options.migrate(parsed, null);
    } catch {
      return null;
    }
  }
  return null;
}

function writeEnvelope<T>(
  key: string,
  value: T | null,
  options: PersistedStateOptions<T>,
) {
  if (value === null) {
    writeRaw(key, null);
    return;
  }
  const serialize = options.serialize ?? JSON.stringify;
  const envelope: Envelope<T> = { v: options.version, d: value };
  writeRaw(key, serialize(envelope as unknown as T));
}

const snapshotCache = new Map<
  string,
  { raw: string | null; value: unknown }
>();

function getSnapshot<T>(key: string, options: PersistedStateOptions<T>): T | null {
  const raw = readRaw(key);
  const cached = snapshotCache.get(key);
  if (cached && cached.raw === raw) {
    return cached.value as T | null;
  }
  const value = readEnvelope(key, options);
  snapshotCache.set(key, { raw, value });
  return value;
}

/**
 * Like `useState`, but persisted to `localStorage` under `key` and synchronised
 * across all consumers (in this tab and across tabs via the `storage` event).
 *
 * Reads are synchronous and happen during render via `useSyncExternalStore`,
 * which is the React 19 idiomatic way to bridge a mutable external store
 * without tearing.
 *
 * `defaultValue` is returned whenever the stored value is missing, fails
 * `options.parse`, or fails `options.migrate`. Pass `null` to clear.
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
      writeEnvelope(key, resolved, options);
      snapshotCache.delete(key);
      notify(key);
    },
    [key, defaultValue, options],
  );

  useDebugValue(value);

  return [value, setValue];
}
