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
      "Mh.",
      "Um.",
      "Uhm,",
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
      "Mhm.",
      "Er.",
      "Äh, 42.",
      "Ähm, 3.",
      "Um, 10.",
      "Ähm, 15:30.",
      "Uh, 2026?",
      "Äh, 50 %",
      "42.",
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
    expect(hesitationMatcher(["euh", 3 as unknown as string])("euh")).toBe(
      true,
    );
    // An entry of more than one sound, or not of letters, disables nothing.
    const odd = hesitationMatcher(["äh ja", "42", "äh"]);
    expect(odd("Ja.")).toBe(false);
    expect(odd("42.")).toBe(false);
    expect(odd("Äh.")).toBe(true);
    // An empty list holds nothing back.
    expect(hesitationMatcher([])("Äh.")).toBe(false);
  });
});
