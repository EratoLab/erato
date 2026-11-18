import { describe, expect, it } from "vitest";

import { hesitationMatcher } from "./hesitations";

describe("hesitation sounds", () => {
  const only = hesitationMatcher(undefined);

  it("knows German and English hesitations, however they are written", () => {
    for (const words of [
      "Äh.",
      "Ähm …",
      "ähhhm",
      "Äh, äh",
      "Hmm.",
      "Mhm.",
      "Um.",
      "Uhm,",
      "Er…",
      "Erm",
      "uh",
    ])
      expect(only(words), words).toBe(true);
  });

  it("does not take words, answers or nothing for hesitations", () => {
    for (const words of [
      "Ja.",
      "Nein.",
      "Yes.",
      "No.",
      "OK.",
      "Äh, wie spät ist es?",
      "Um, what time is it?",
      "Uh-huh",
      "",
      "…",
    ])
      expect(only(words), words).toBe(false);
  });

  it("takes the deployment's list instead of the base", () => {
    const custom = hesitationMatcher(["euh", "bah"]);
    expect(custom("Euh…")).toBe(true);
    expect(custom("Äh")).toBe(false);
    // A malformed entry is skipped, the rest still counts.
    expect(hesitationMatcher(["euh", 3 as unknown as string])("euh")).toBe(true);
  });
});
