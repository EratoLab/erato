const FALLBACK_INTERVAL_MS = 600;

export interface BlinkHandle {
  stop: () => void;
}

export const shouldBlink = (): boolean =>
  typeof window.matchMedia !== "function" ||
  !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Ticks from a worker so the blink survives a hidden tab's 1 Hz timer clamp;
 * a main-thread interval covers browsers or builds without worker support.
 */
export const startBlink = (onTick: () => void): BlinkHandle => {
  try {
    const worker = new Worker(new URL("./blink.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = () => {
      onTick();
    };
    return {
      stop: () => {
        worker.terminate();
      },
    };
  } catch {
    const timer = setInterval(onTick, FALLBACK_INTERVAL_MS);
    return {
      stop: () => {
        clearInterval(timer);
      },
    };
  }
};
