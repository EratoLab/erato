export class GraphTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphTimeoutError";
  }
}

/**
 * Runs a Graph fetch under a timeout, optionally chained to a parent signal
 * (e.g. TanStack Query's per-query signal or an effect-lifecycle controller).
 *
 * The composed signal aborts when *either* the timeout elapses — surfacing a
 * {@link GraphTimeoutError} as the abort `reason` so callers can tell a
 * timeout apart from a cancellation — or the parent aborts, propagating the
 * parent's reason. `AbortSignal.any` owns the listener wiring (and its own
 * teardown), so this helper only has to clear its timer; the `finally`
 * guarantees that even on rejection.
 */
export async function runWithGraphTimeout<T>(
  timeoutMs: number,
  message: string,
  parentSignal: AbortSignal | undefined,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const timeoutController = new AbortController();
  const timeoutId = globalThis.setTimeout(() => {
    timeoutController.abort(new GraphTimeoutError(message));
  }, timeoutMs);

  const signal = parentSignal
    ? AbortSignal.any([parentSignal, timeoutController.signal])
    : timeoutController.signal;

  try {
    return await run(signal);
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}
