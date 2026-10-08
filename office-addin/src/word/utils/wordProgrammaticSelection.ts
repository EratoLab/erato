/** Word fires DocumentSelectionChanged 90-360 ms after a select() sync; the window also covers the
 * sync round-trip itself, which is slowest on the web. */
export const PROGRAMMATIC_SELECTION_WINDOW_MS = 2000;

let markedAt: number | null = null;

/** Call right before queuing select(), so the event it causes is not taken for the user's choice. */
export function markProgrammaticWordSelection(now = Date.now()): void {
  markedAt = now;
}

/** True once for the first selection event inside the window after a mark; the mark is spent
 * either way, so a later event counts as the user's. */
export function consumeProgrammaticSelectionEvent(now = Date.now()): boolean {
  if (markedAt === null) return false;
  const elapsed = now - markedAt;
  markedAt = null;
  return elapsed >= 0 && elapsed <= PROGRAMMATIC_SELECTION_WINDOW_MS;
}

export function resetProgrammaticWordSelectionForTests(): void {
  markedAt = null;
}
