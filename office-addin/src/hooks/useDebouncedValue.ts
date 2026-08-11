import { useEffect, useRef, useState } from "react";

export interface UseDebouncedValueOptions {
  /**
   * When true, the first observed value transition after mount is forwarded
   * immediately (no `delayMs` wait). Subsequent transitions still debounce
   * trailing-edge.
   *
   * Useful when the same hook serves both a cold-open (where waiting feels
   * like a stall) and a high-frequency event stream (where collapsing bursts
   * is the whole point). For example: the Outlook session anchor wants the
   * first reading to land instantly so the policy can fire without a 400 ms
   * blank window, while still debouncing rapid `ItemChanged` events during
   * inbox navigation.
   */
  leading?: boolean;
}

/**
 * Returns a copy of `value` that lags `delayMs` behind the live one. Each
 * change resets the timer; rapid bursts collapse to a single trailing update.
 *
 * Pass `{ leading: true }` to forward the first transition without waiting —
 * see `UseDebouncedValueOptions.leading`.
 */
export function useDebouncedValue<T>(
  value: T,
  delayMs: number,
  options: UseDebouncedValueOptions = {},
): T {
  const { leading = false } = options;
  const [debounced, setDebounced] = useState(value);
  const previousValueRef = useRef(value);
  const hasFiredLeadingRef = useRef(false);

  useEffect(() => {
    const isChange = !Object.is(previousValueRef.current, value);
    previousValueRef.current = value;
    if (!isChange) return;

    if (leading && !hasFiredLeadingRef.current) {
      hasFiredLeadingRef.current = true;
      setDebounced(value);
      return;
    }

    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs, leading]);

  return debounced;
}
