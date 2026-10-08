/** Word fires DocumentSelectionChanged 90-360 ms after a select() sync (SV2:64). */
export const PROGRAMMATIC_SELECTION_WINDOW_MS = 2000;

interface Mark {
  since: number;
}

/** One per select(), oldest first, so two quick selects cannot share one claim. */
let marks: Mark[] = [];

export interface ProgrammaticWordSelection {
  /** The select() sync resolved; its event is due within the window from now. */
  selected(now?: number): void;
  /** Nothing was selected, so no event will come. */
  cancel(): void;
}

/** Call right before queuing select(), so the event it causes is not taken for the user's choice. */
export function markProgrammaticWordSelection(
  now = Date.now(),
): ProgrammaticWordSelection {
  const mark: Mark = { since: now };
  marks = marks.filter(
    (other) => now - other.since <= PROGRAMMATIC_SELECTION_WINDOW_MS,
  );
  marks.push(mark);
  return {
    selected: (at = Date.now()) => {
      mark.since = Math.max(mark.since, at);
    },
    cancel: () => {
      marks = marks.filter((other) => other !== mark);
    },
  };
}

/** True when a live mark claims this event; each mark claims one, so a later event counts as the user's. */
export function consumeProgrammaticSelectionEvent(now = Date.now()): boolean {
  marks = marks.filter(
    (mark) => now - mark.since <= PROGRAMMATIC_SELECTION_WINDOW_MS,
  );
  return marks.shift() !== undefined;
}

export function resetProgrammaticWordSelectionForTests(): void {
  marks = [];
}
