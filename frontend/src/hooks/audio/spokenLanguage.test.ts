import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  noteSpokenTurnLanguage,
  resetSpokenLanguage,
  spokenTurnLanguage,
  takeSpokenTurnLanguage,
} from "./spokenLanguage";

vi.mock("@/lib/i18n", async (original) => ({
  ...(await original<typeof import("@/lib/i18n")>()),
  loadCatalog: vi.fn(() => Promise.resolve(false)),
}));

describe("spoken language of a turn", () => {
  beforeEach(() => resetSpokenLanguage());

  it("belongs to the message sent next, and stays for typed ones after it", () => {
    expect(takeSpokenTurnLanguage()).toBeUndefined();
    noteSpokenTurnLanguage("de");
    expect(spokenTurnLanguage()).toBeUndefined();
    expect(takeSpokenTurnLanguage()).toBe("de");
    expect(spokenTurnLanguage()).toBe("de");
    // A typed message carries none, and the voice keeps German.
    expect(takeSpokenTurnLanguage()).toBeUndefined();
    expect(spokenTurnLanguage()).toBe("de");
    noteSpokenTurnLanguage("en");
    expect(takeSpokenTurnLanguage()).toBe("en");
    expect(spokenTurnLanguage()).toBe("en");
  });
});
