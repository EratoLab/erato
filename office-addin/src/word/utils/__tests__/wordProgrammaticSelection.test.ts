import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  consumeProgrammaticSelectionEvent,
  markProgrammaticWordSelection,
  onProgrammaticWordSelection,
  PROGRAMMATIC_SELECTION_WINDOW_MS,
  resetProgrammaticWordSelectionForTests,
} from "../wordProgrammaticSelection";

const WINDOW = PROGRAMMATIC_SELECTION_WINDOW_MS;

describe("programmatic Word selection marker", () => {
  beforeEach(resetProgrammaticWordSelectionForTests);

  it("passes events through when nothing was marked", () => {
    expect(consumeProgrammaticSelectionEvent(1_000)).toBe(false);
  });

  it("claims only the first event inside the window", () => {
    markProgrammaticWordSelection(1_000);
    expect(consumeProgrammaticSelectionEvent(1_300)).toBe(true);
    expect(consumeProgrammaticSelectionEvent(1_400)).toBe(false);
  });

  it("claims an event at the end of the window", () => {
    markProgrammaticWordSelection(1_000);
    expect(consumeProgrammaticSelectionEvent(1_000 + WINDOW)).toBe(true);
  });

  it("lets the user's event through once the mark expired", () => {
    markProgrammaticWordSelection(1_000);
    expect(consumeProgrammaticSelectionEvent(1_001 + WINDOW)).toBe(false);
  });

  it("claims one event per select, so a second select's event is not taken for the user's", () => {
    markProgrammaticWordSelection(1_000);
    markProgrammaticWordSelection(1_200);
    expect(consumeProgrammaticSelectionEvent(1_350)).toBe(true);
    expect(consumeProgrammaticSelectionEvent(1_550)).toBe(true);
    expect(consumeProgrammaticSelectionEvent(1_700)).toBe(false);
  });

  it("restarts the window when the select sync resolves", () => {
    const mark = markProgrammaticWordSelection(1_000);
    mark.selected(1_000 + WINDOW);
    expect(consumeProgrammaticSelectionEvent(1_200 + WINDOW)).toBe(true);
  });

  it("leaves no mark for a select that failed or changed nothing", () => {
    markProgrammaticWordSelection(1_000).cancel();
    expect(consumeProgrammaticSelectionEvent(1_300)).toBe(false);
    const kept = markProgrammaticWordSelection(1_000);
    markProgrammaticWordSelection(1_100).cancel();
    expect(consumeProgrammaticSelectionEvent(1_300)).toBe(true);
    kept.cancel();
    expect(consumeProgrammaticSelectionEvent(1_400)).toBe(false);
  });
});

describe("programmatic Word selection listeners", () => {
  it("hears every mark until it unsubscribes", () => {
    const heard = vi.fn();
    const stop = onProgrammaticWordSelection(heard);
    markProgrammaticWordSelection(1_000);
    stop();
    markProgrammaticWordSelection(1_100);
    expect(heard).toHaveBeenCalledTimes(1);
  });
});
