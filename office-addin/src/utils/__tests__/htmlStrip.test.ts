import { describe, it, expect } from "vitest";

import { stripHtmlTags } from "../htmlStrip";

describe("stripHtmlTags", () => {
  it("strips simple HTML tags", () => {
    expect(stripHtmlTags("<p>Hello</p>")).toBe("Hello");
  });

  it("handles nested tags", () => {
    expect(stripHtmlTags("<div><b>Bold</b> and <i>italic</i></div>")).toBe(
      "Bold and italic",
    );
  });

  it("returns empty string for empty input", () => {
    expect(stripHtmlTags("")).toBe("");
  });

  it("returns plain text unchanged", () => {
    expect(stripHtmlTags("no tags here")).toBe("no tags here");
  });

  it("decodes HTML entities", () => {
    expect(stripHtmlTags("&amp; &lt; &gt;")).toBe("& < >");
  });

  it("handles self-closing tags", () => {
    expect(stripHtmlTags("line one<br/>line two")).toBe("line oneline two");
  });
});
