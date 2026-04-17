import { describe, it, expect } from "vitest";

import { isHexDark } from "../luminance";

describe("isHexDark", () => {
  it("classifies white as light", () => {
    expect(isHexDark("#FFFFFF")).toBe(false);
  });

  it("classifies black as dark", () => {
    expect(isHexDark("#000000")).toBe(true);
  });

  it("treats mid-grey #808080 as light (brightness just above 0.5)", () => {
    expect(isHexDark("#808080")).toBe(false);
  });

  it("treats #7F7F7F as dark (brightness just below 0.5)", () => {
    expect(isHexDark("#7F7F7F")).toBe(true);
  });

  it("expands the 3-char form (#FFF)", () => {
    expect(isHexDark("#FFF")).toBe(false);
    expect(isHexDark("#000")).toBe(true);
  });

  it("accepts hex values without a leading hash", () => {
    expect(isHexDark("FFFFFF")).toBe(false);
  });

  it("returns false for malformed input rather than throwing", () => {
    expect(isHexDark("not-a-color")).toBe(false);
  });
});
