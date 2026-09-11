import { describe, it, expect, afterEach, vi } from "vitest";

import { UploadTooLargeError, isUploadTooLarge } from "../errors";

/**
 * The e2e suite asserts on substrings of this message. A singular rejection
 * must keep saying "File is too large" or `chat.basic` and `mock-flows`
 * break without either spec being touched.
 */
describe("UploadTooLargeError message", () => {
  it("keeps the singular wording the e2e specs assert on", () => {
    const error = new UploadTooLargeError("15 MB", ["big-file-60mb.pdf"]);

    expect(error.message).toContain("File is too large");
    expect(error.message).toContain("big-file-60mb.pdf");
    expect(error.message).toContain("15 MB");
  });

  it("inflects the plural instead of using a parenthetical", () => {
    const error = new UploadTooLargeError("15 MB", ["a.pdf", "b.pdf"]);

    expect(error.message).toContain("Files are too large");
    expect(error.message).toContain("a.pdf, b.pdf");
    expect(error.message).not.toContain("(s)");
  });

  it("falls back to the unnamed message when no filenames are known", () => {
    const error = new UploadTooLargeError("15 MB");

    expect(error.message).toBe("File is too large. Maximum size: 15 MB.");
    expect(error.filenames).toEqual([]);
  });
});

describe("isUploadTooLarge", () => {
  const originalAgent = navigator.userAgent;

  afterEach(() => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(originalAgent);
    vi.restoreAllMocks();
  });

  it("matches a numeric 413", () => {
    expect(isUploadTooLarge({ status: 413, payload: "" })).toBe(true);
  });

  it("matches a string 413", () => {
    expect(isUploadTooLarge({ status: "413", payload: "" })).toBe(true);
  });

  it("ignores unrelated errors", () => {
    expect(isUploadTooLarge({ status: 500, payload: "" })).toBe(false);
    expect(isUploadTooLarge(new Error("boom"))).toBe(false);
    expect(isUploadTooLarge(null)).toBe(false);
    expect(isUploadTooLarge(undefined)).toBe(false);
    expect(isUploadTooLarge("413")).toBe(false);
  });

  it("treats an opaque Firefox NetworkError as too-large", () => {
    // Firefox reports a proxy cutting off an oversized body as a bare
    // NetworkError with no status, so the browser sniff is the only signal.
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Macintosh) Gecko/20100101 Firefox/128.0",
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(isUploadTooLarge({ message: "NetworkError when fetching" })).toBe(
      true,
    );
  });

  it("does not apply the NetworkError fallback outside Firefox", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
    );

    expect(isUploadTooLarge({ message: "NetworkError when fetching" })).toBe(
      false,
    );
  });
});
