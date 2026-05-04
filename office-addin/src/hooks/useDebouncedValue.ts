import { useEffect, useState } from "react";

/**
 * Returns a copy of `value` that lags `delayMs` behind the live one. Each
 * change resets the timer; rapid bursts collapse to a single trailing update.
 *
 * Useful for events that fire many times per second — e.g. Outlook's
 * `ItemChanged` while the user arrow-keys through the inbox — where we only
 * want to react once the selection has settled.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);

  return debounced;
}
