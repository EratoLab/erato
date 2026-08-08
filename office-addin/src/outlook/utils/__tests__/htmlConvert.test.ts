import { describe, it, expect } from "vitest";

import { escapeHtml, plainTextToHtml } from "../htmlConvert";

describe("escapeHtml", () => {
  it("escapes ampersands", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  it("escapes angle brackets", () => {
    expect(escapeHtml("use <br> tags")).toBe("use &lt;br&gt; tags");
  });

  it("escapes double quotes", () => {
    expect(escapeHtml('say "hello"')).toBe("say &quot;hello&quot;");
  });

  it("returns empty string for empty input", () => {
    expect(escapeHtml("")).toBe("");
  });

  it("leaves plain text unchanged", () => {
    expect(escapeHtml("no special chars")).toBe("no special chars");
  });
});

describe("plainTextToHtml", () => {
  it("converts newlines to <br> tags", () => {
    expect(plainTextToHtml("line one\nline two")).toBe(
      "line one<br>\nline two",
    );
  });

  it("preserves multiple consecutive newlines", () => {
    expect(plainTextToHtml("a\n\nb")).toBe("a<br>\n<br>\nb");
  });

  it("escapes HTML characters before converting newlines", () => {
    expect(plainTextToHtml("a < b\nc > d")).toBe("a &lt; b<br>\nc &gt; d");
  });

  it("handles text with no newlines", () => {
    expect(plainTextToHtml("single line")).toBe("single line");
  });

  it("handles empty string", () => {
    expect(plainTextToHtml("")).toBe("");
  });

  it("handles realistic email suggestion content", () => {
    const input =
      "Could you please review the attached draft?\n\nThanks,\nDaniel";
    const expected =
      "Could you please review the attached draft?<br>\n<br>\nThanks,<br>\nDaniel";
    expect(plainTextToHtml(input)).toBe(expected);
  });
});
