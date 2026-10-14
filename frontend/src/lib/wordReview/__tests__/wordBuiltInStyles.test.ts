import { describe, expect, it } from "vitest";

import {
  wordBuiltInParagraphStyle,
  wordHeadingStyle,
} from "../wordBuiltInStyles";

describe("wordBuiltInParagraphStyle", () => {
  it("goes by the name before the first comma, as Word does", () => {
    expect(wordBuiltInParagraphStyle("heading 2,h2")).toBe("Heading2");
    expect(wordBuiltInParagraphStyle("Normal,N")).toBe("Normal");
    expect(wordBuiltInParagraphStyle("toc 1,Contents")).toBe("Toc1");
    expect(wordBuiltInParagraphStyle("h2,heading 2")).toBeUndefined();
    expect(wordBuiltInParagraphStyle("Heading2")).toBeUndefined();
  });
});

describe("wordHeadingStyle", () => {
  const custom = { id: "Heading2", name: "Heading2" };
  const localized = { id: "berschrift2", name: "heading 2" };

  it("takes Word's built-in heading by name before a style with its ID", () => {
    expect(wordHeadingStyle([custom, localized], 2)).toBe(localized);
    expect(
      wordHeadingStyle([custom, { ...localized, name: "heading 2,h2" }], 2)?.id,
    ).toBe("berschrift2");
    expect(wordHeadingStyle([custom], 2)).toBe(custom);
    expect(wordHeadingStyle([custom, localized], 3)).toBeUndefined();
  });
});
