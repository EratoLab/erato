import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  mainLanguage,
  noteSpokenTurnLanguage,
  refreshMainLanguage,
  resetSpokenLanguage,
  spokenTurnLanguage,
  takeSpokenTurnLanguage,
} from "./spokenLanguage";

const fetchSpokenLanguage = vi.hoisted(() => vi.fn());
vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  fetchSpokenLanguage,
}));

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
    expect(takeSpokenTurnLanguage()).toBeUndefined();
    expect(spokenTurnLanguage()).toBe("de");
    noteSpokenTurnLanguage("en");
    expect(takeSpokenTurnLanguage()).toBe("en");
    expect(spokenTurnLanguage()).toBe("en");
  });
});

describe("the person's main language", () => {
  beforeEach(() => resetSpokenLanguage());

  it("is the first language they speak once the backend answers", async () => {
    const before = mainLanguage();
    fetchSpokenLanguage.mockResolvedValueOnce({ main: "hi" });
    await refreshMainLanguage();
    expect(mainLanguage()).toBe("hi");

    resetSpokenLanguage();
    expect(mainLanguage()).toBe(before);
  });

  it("stays the interface language when the backend cannot answer", async () => {
    const before = mainLanguage();
    fetchSpokenLanguage.mockRejectedValueOnce(new Error("offline"));
    await refreshMainLanguage();
    expect(mainLanguage()).toBe(before);
  });
});
