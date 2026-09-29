/** Dev-only User Timing marks for the send preparation, read in the Performance panel. */
export function markWordSend(
  step: "prepare-start" | "capture-end" | "budget-end" | "prepare-end",
): void {
  if (!import.meta.env.DEV) return;
  globalThis.performance?.mark(`erato:word-send:${step}`);
}
