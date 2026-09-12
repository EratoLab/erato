// Hidden tabs clamp main-thread timers to 1 Hz; a worker timer is exempt.
const BLINK_INTERVAL_MS = 600;

setInterval(() => {
  (
    globalThis as unknown as { postMessage: (message: number) => void }
  ).postMessage(1);
}, BLINK_INTERVAL_MS);
