import { describe, expect, it } from "vitest";

import {
  ACTION_FACET_ARG_MAX_BYTES,
  advertisedFacetArgs,
  fitsActionFacetArg,
  utf8ByteLength,
} from "../actionFacetArgs";

describe("utf8ByteLength", () => {
  it("counts UTF-8 bytes, not UTF-16 units", () => {
    expect(utf8ByteLength("abc")).toBe(3);
    expect(utf8ByteLength("ä")).toBe(2);
    expect(utf8ByteLength("€")).toBe(3);
    expect(utf8ByteLength("😀")).toBe(4);
  });
});

describe("fitsActionFacetArg", () => {
  it("matches the backend's 64 KiB limit", () => {
    expect(ACTION_FACET_ARG_MAX_BYTES).toBe(65_536);
    expect(fitsActionFacetArg("x".repeat(65_536))).toBe(true);
    expect(fitsActionFacetArg("x".repeat(65_537))).toBe(false);
  });

  it("measures multibyte text in bytes", () => {
    expect(fitsActionFacetArg("ä".repeat(32_768))).toBe(true);
    expect(fitsActionFacetArg(`${"ä".repeat(32_768)}x`)).toBe(false);
    expect(fitsActionFacetArg("€".repeat(21_846))).toBe(false);
  });
});

describe("advertisedFacetArgs", () => {
  const args = { kept: "a", empty: "", dropped: "b" };

  it("keeps advertised keys, empty values included, and drops the rest", () => {
    expect(advertisedFacetArgs(args, new Set(["kept", "empty"]))).toEqual({
      kept: "a",
      empty: "",
    });
  });

  it("sends nothing when the server lists no arguments", () => {
    expect(advertisedFacetArgs(args, undefined)).toEqual({});
    expect(advertisedFacetArgs(args, new Set())).toEqual({});
  });
});
