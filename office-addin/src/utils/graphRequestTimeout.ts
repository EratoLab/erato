export const OUTLOOK_GRAPH_MESSAGE_TIMEOUT_MS = 10_000;
export const OUTLOOK_GRAPH_THREAD_TIMEOUT_MS = 20_000;

export class OutlookGraphTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutlookGraphTimeoutError";
  }
}

export function createTimeoutSignal(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
  message: string,
): { signal: AbortSignal; abort: () => void; dispose: () => void } {
  const controller = new AbortController();
  let disposed = false;

  const abortFromParent = () => {
    if (!controller.signal.aborted) {
      controller.abort(parentSignal?.reason);
    }
  };

  if (parentSignal?.aborted) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  }

  const timeoutId = globalThis.setTimeout(() => {
    if (!controller.signal.aborted) {
      controller.abort(new OutlookGraphTimeoutError(message));
    }
  }, timeoutMs);

  return {
    signal: controller.signal,
    abort: () => {
      if (!controller.signal.aborted) {
        controller.abort();
      }
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      globalThis.clearTimeout(timeoutId);
      parentSignal?.removeEventListener("abort", abortFromParent);
    },
  };
}
