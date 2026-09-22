import { describe, expect, it } from "vitest";

import { textDiff } from "./textDiff";

describe("exact Word text comparison", () => {
  it.each([
    ["alpha beta", "alpha  beta"],
    ["alpha beta", " alpha beta"],
    ["alpha\nbeta", "alpha\r\nbeta"],
    ["alpha\tbeta", "alpha beta"],
    ["one\n\ntwo", "one\ntwo"],
    ["😀 café e\u0301", "😀 café é"],
    ["clear this", ""],
    ["", "new"],
  ])("round-trips both exact texts: %j → %j", (original, proposed) => {
    const diff = textDiff(original, proposed)!;
    expect(
      diff
        .filter((part) => part.kind !== "added")
        .map((part) => part.text)
        .join(""),
    ).toBe(original);
    expect(
      diff
        .filter((part) => part.kind !== "removed")
        .map((part) => part.text)
        .join(""),
    ).toBe(proposed);
    expect(diff.some((part) => part.kind !== "same")).toBe(true);
  });
  it("bounds expensive comparisons without truncating the input", () => {
    expect(textDiff("word ".repeat(600), "other ".repeat(600))).toBeNull();
    expect(textDiff("x".repeat(90_000), "new")).toBeNull();
  });
});
