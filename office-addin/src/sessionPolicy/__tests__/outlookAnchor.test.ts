import { describe, expect, it } from "vitest";

import {
  anchorsEqualForPreferences,
  composeInheritsAnchorsEqual,
  strictAnchorsEqual,
} from "../outlookAnchor";

import type { OutlookSessionAnchor } from "../types";

const read = (conv: string | null): OutlookSessionAnchor => ({
  conversationId: conv,
  isCompose: false,
});

const compose = (conv: string | null): OutlookSessionAnchor => ({
  conversationId: conv,
  isCompose: true,
});

describe("strictAnchorsEqual", () => {
  it("equal when both null", () => {
    expect(strictAnchorsEqual(null, null)).toBe(true);
  });

  it("not equal when one is null", () => {
    expect(strictAnchorsEqual(null, read("T1"))).toBe(false);
  });

  it("equal when same conversation and same mode", () => {
    expect(strictAnchorsEqual(read("T1"), read("T1"))).toBe(true);
    expect(strictAnchorsEqual(compose("T1"), compose("T1"))).toBe(true);
  });

  it("not equal when same conversation but different mode", () => {
    expect(strictAnchorsEqual(read("T1"), compose("T1"))).toBe(false);
  });

  it("not equal when both have null conversationId (treated as distinct)", () => {
    expect(strictAnchorsEqual(compose(null), compose(null))).toBe(false);
  });
});

describe("composeInheritsAnchorsEqual", () => {
  it("treats compose-of-same-thread as equal to read of that thread", () => {
    expect(composeInheritsAnchorsEqual(read("T1"), compose("T1"))).toBe(true);
    expect(composeInheritsAnchorsEqual(compose("T1"), read("T1"))).toBe(true);
  });

  it("does not equate composes of different threads", () => {
    expect(composeInheritsAnchorsEqual(read("T1"), compose("T2"))).toBe(false);
  });

  it("does not equate brand-new composes (null thread) to anything", () => {
    expect(composeInheritsAnchorsEqual(read("T1"), compose(null))).toBe(false);
    expect(composeInheritsAnchorsEqual(compose(null), compose(null))).toBe(
      false,
    );
  });
});

describe("anchorsEqualForPreferences", () => {
  it("returns strict equality when composeInheritsFromRead = false", () => {
    const eq = anchorsEqualForPreferences({
      mode: "ask",
      composeInheritsFromRead: false,
    });
    expect(eq(read("T1"), compose("T1"))).toBe(false);
  });

  it("returns inherit equality when composeInheritsFromRead = true", () => {
    const eq = anchorsEqualForPreferences({
      mode: "ask",
      composeInheritsFromRead: true,
    });
    expect(eq(read("T1"), compose("T1"))).toBe(true);
  });
});
