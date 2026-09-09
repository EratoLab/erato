import { describe, it, expect } from "vitest";

import { UploadTooLargeError } from "../errors";

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
