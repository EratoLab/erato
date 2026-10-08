import { beforeEach, describe, expect, it } from "vitest";

import {
  consumeProgrammaticSelectionEvent,
  markProgrammaticWordSelection,
  PROGRAMMATIC_SELECTION_WINDOW_MS,
  resetProgrammaticWordSelectionForTests,
} from "../wordProgrammaticSelection";

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
    expect(
      consumeProgrammaticSelectionEvent(
        1_000 + PROGRAMMATIC_SELECTION_WINDOW_MS,
      ),
    ).toBe(true);
  });

  it("lets the user's event through once the mark expired", () => {
    markProgrammaticWordSelection(1_000);
    expect(
      consumeProgrammaticSelectionEvent(
        1_001 + PROGRAMMATIC_SELECTION_WINDOW_MS,
      ),
    ).toBe(false);
  });

  it("counts from the latest mark", () => {
    markProgrammaticWordSelection(1_000);
    markProgrammaticWordSelection(1_000 + PROGRAMMATIC_SELECTION_WINDOW_MS);
    expect(
      consumeProgrammaticSelectionEvent(
        1_100 + PROGRAMMATIC_SELECTION_WINDOW_MS,
      ),
    ).toBe(true);
  });
});
