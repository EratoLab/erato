import { i18n } from "@lingui/core";
import { beforeEach, describe, expect, it } from "vitest";

import { quotedSelection, selectionExcerpt } from "../selectionExcerpt";

describe("selectionExcerpt", () => {
  it("keeps a short passage whole", () => {
    expect(selectionExcerpt("Revenue grew.")).toBe("Revenue grew.");
    expect(selectionExcerpt("x".repeat(60))).toBe("x".repeat(60));
  });

  it("cuts after 60 code points and marks the cut", () => {
    const cut = selectionExcerpt("y".repeat(61));
    expect(cut).toBe(`${"y".repeat(60)}…`);
    expect(Array.from(cut)).toHaveLength(61);
  });

  it("never splits a surrogate pair", () => {
    const cut = selectionExcerpt("😀".repeat(70));
    expect(cut).toBe(`${"😀".repeat(60)}…`);
    expect(cut).not.toContain("�");
  });

  it("puts paragraphs on one line", () => {
    expect(selectionExcerpt("First line\nSecond\r\n\tthird  ")).toBe(
      "First line Second third",
    );
  });

  it("does not end a cut on a space", () => {
    expect(selectionExcerpt(`${"a".repeat(59)} bcd`)).toBe(
      `${"a".repeat(59)}…`,
    );
  });
});

describe("quotedSelection", () => {
  beforeEach(() => {
    i18n.activate("en");
  });

  it("puts the excerpt in quotation marks", () => {
    expect(quotedSelection("lima mike")).toBe("“lima mike”");
  });
});
