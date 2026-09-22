import { describe, expect, it } from "vitest";

import {
  buildWordDocumentArgs,
  cutToUtf8Bytes,
  DOCUMENT_TEXT_BUDGET_BYTES,
  HEADING_OUTLINE_BUDGET_BYTES,
  normalizeParagraphText,
  resolveHeadingLevel,
} from "../buildWordDocumentArgs";

import type { WordParagraphRead } from "../buildWordDocumentArgs";

const encoder = new TextEncoder();
const bytes = (value: string) => encoder.encode(value).length;

const paragraph = (
  ordinal: number,
  text: string,
  overrides: Partial<WordParagraphRead> = {},
): WordParagraphRead => ({
  ordinal,
  text,
  uniqueLocalId: `id-${ordinal}`,
  styleBuiltIn: "Normal",
  // Word uses outline level 10 for body text; another default would hide a broken fallback.
  outlineLevel: 10,
  ...overrides,
});

describe("buildWordDocumentArgs", () => {
  it("tags ordinals densely across empty paragraphs and headings", () => {
    const build = buildWordDocumentArgs([
      paragraph(1, "The Annual Report", { styleBuiltIn: "Title" }),
      paragraph(2, ""),
      paragraph(3, "Overview", { styleBuiltIn: "Heading2" }),
      paragraph(4, "Revenue grew."),
      paragraph(5, "   "),
      paragraph(6, "Costs fell.", { styleBuiltIn: "Other", outlineLevel: 3 }),
    ]);

    expect(build.args.document_text).toBe(
      [
        "[1|H1] The Annual Report",
        "[3|H2] Overview",
        "[4] Revenue grew.",
        "[6|H3] Costs fell.",
      ].join("\n"),
    );
    expect(build.args.paragraphs_sent).toBe("6");
    expect(build.args.paragraphs_total).toBe("6");
    expect(build.coverage.truncated).toBe(false);
  });

  it("reports ONLY the ordinals it rendered a full line for", () => {
    const build = buildWordDocumentArgs([
      paragraph(1, "First"),
      paragraph(2, ""),
      paragraph(3, "\t"),
      paragraph(4, "Fourth"),
    ]);

    // Blank text would match itself even for a drifted ordinal; only the rendered set catches it.
    expect([...build.renderedOrdinals].sort((a, b) => a - b)).toEqual([1, 4]);
    expect(build.partialOrdinal).toBeNull();
    expect(build.args.paragraphs_sent).toBe("4");
  });

  it("names the cut paragraph instead of calling it rendered", () => {
    const wall = "w".repeat(DOCUMENT_TEXT_BUDGET_BYTES * 2);
    const build = buildWordDocumentArgs([
      paragraph(1, wall),
      paragraph(2, "After the wall."),
    ]);

    expect(build.renderedOrdinals.has(1)).toBe(false);
    expect(build.partialOrdinal).toBe(1);
    expect(build.args.paragraphs_sent).toBe("1");
    expect(build.coverage.partialParagraph).toBe(true);
  });

  it("maps every paragraph into the ordinal map, empty ones included", () => {
    const build = buildWordDocumentArgs([
      paragraph(1, "First"),
      paragraph(2, ""),
      paragraph(3, "Third"),
    ]);

    expect([...build.ordinalMap.keys()]).toEqual([1, 2, 3]);
    expect(build.ordinalMap.get(2)).toEqual({
      uniqueLocalId: "id-2",
      text: "",
    });
    expect(build.ordinalMap.get(3)).toEqual({
      uniqueLocalId: "id-3",
      text: "Third",
    });
  });

  it("returns every argument as a string", () => {
    const build = buildWordDocumentArgs([paragraph(1, "Only")]);
    for (const value of Object.values(build.args)) {
      expect(typeof value).toBe("string");
    }
  });

  it("budgets in UTF-8 bytes, not UTF-16 string length", () => {
    // Umlauts distinguish the backend UTF-8 byte cap from JavaScript string length.
    const line = "Größenänderung für Übermäßigkeit ".repeat(30);
    const paragraphs = Array.from({ length: 1_400 }, (_unused, index) =>
      paragraph(index + 1, line),
    );

    const build = buildWordDocumentArgs(paragraphs);
    const documentText = build.args.document_text;

    expect(documentText.length).toBeGreaterThan(DOCUMENT_TEXT_BUDGET_BYTES / 2);
    expect(documentText.length).toBeLessThan(DOCUMENT_TEXT_BUDGET_BYTES);
    expect(bytes(documentText)).toBeLessThanOrEqual(DOCUMENT_TEXT_BUDGET_BYTES);
    const sent = Number(build.args.paragraphs_sent);
    expect(
      bytes(documentText) + bytes(`\n[${sent + 1}] ${line}`),
    ).toBeGreaterThan(DOCUMENT_TEXT_BUDGET_BYTES);
    expect(build.coverage.truncated).toBe(true);
  });

  it("cuts on a paragraph boundary and never mid-paragraph", () => {
    const line = "x".repeat(1_000);
    const paragraphs = Array.from({ length: 200 }, (_unused, index) =>
      paragraph(index + 1, line),
    );

    const build = buildWordDocumentArgs(paragraphs);
    const rendered = build.args.document_text.split("\n");

    for (const entry of rendered) {
      expect(entry.endsWith(line)).toBe(true);
    }
    expect(rendered.length).toBe(Number(build.args.paragraphs_sent));
    expect(build.args.truncation_note).toBe("");
    expect(bytes(build.args.document_text)).toBeLessThanOrEqual(
      DOCUMENT_TEXT_BUDGET_BYTES,
    );
    expect(
      bytes(build.args.document_text) + bytes(`\n[201] ${line}`),
    ).toBeGreaterThan(DOCUMENT_TEXT_BUDGET_BYTES);
  });

  it("charges the joining newline exactly once per line", () => {
    const paragraphs = Array.from({ length: 40 }, (_unused, index) =>
      paragraph(index + 1, "ä".repeat(50)),
    );
    const build = buildWordDocumentArgs(paragraphs);
    const accumulated = build.args.document_text
      .split("\n")
      .reduce(
        (total, line, index) => total + bytes(line) + (index === 0 ? 0 : 1),
        0,
      );

    expect(accumulated).toBe(bytes(build.args.document_text));
  });

  it("cuts a single oversized paragraph on a code-point boundary", () => {
    const wall = "😀".repeat(30_000);
    const build = buildWordDocumentArgs([
      paragraph(1, ""),
      paragraph(2, wall),
      paragraph(3, "After the wall."),
    ]);
    const documentText = build.args.document_text;

    expect(documentText.startsWith("[2] ")).toBe(true);
    expect(documentText.length).toBeGreaterThan(0);
    expect(bytes(documentText)).toBeLessThanOrEqual(DOCUMENT_TEXT_BUDGET_BYTES);
    expect(documentText).not.toContain("�");
    expect(new TextDecoder().decode(encoder.encode(documentText))).toBe(
      documentText,
    );
    expect([...documentText].every((codePoint) => codePoint.length <= 2)).toBe(
      true,
    );
    expect(build.args.truncation_note).toBe(
      "Paragraph 2 is included only in part, because it alone exceeds the send limit.",
    );
    expect(build.coverage.partialParagraph).toBe(true);
    expect(build.args.paragraphs_sent).toBe("2");
    expect(build.args.paragraphs_total).toBe("3");
  });

  it("leaves the truncation note empty in every normal case", () => {
    expect(
      buildWordDocumentArgs([paragraph(1, "Short")]).args.truncation_note,
    ).toBe("");
    const paragraphs = Array.from({ length: 200 }, (_unused, index) =>
      paragraph(index + 1, "y".repeat(1_000)),
    );
    expect(buildWordDocumentArgs(paragraphs).args.truncation_note).toBe("");
  });

  it("normalizes in-paragraph line breaks to a single space", () => {
    const build = buildWordDocumentArgs([
      paragraph(1, `one\u000Btwo`),
      paragraph(2, `three\r\nfour`),
      paragraph(3, `five\nsix`),
    ]);

    expect(build.args.document_text).toBe(
      ["[1] one two", "[2] three four", "[3] five six"].join("\n"),
    );
    expect(build.args.document_text.split("\n")).toHaveLength(3);
  });

  it("carries a heading outline only for what lies beyond the window", () => {
    const filler = "z".repeat(1_000);
    const paragraphs = [
      ...Array.from({ length: 70 }, (_unused, index) =>
        paragraph(index + 1, filler, {
          styleBuiltIn: index === 0 ? "Heading1" : "Normal",
        }),
      ),
      ...Array.from({ length: 500 }, (_unused, index) =>
        paragraph(71 + index, `Section ${index + 1}`, {
          styleBuiltIn: "Heading2",
        }),
      ),
    ];

    const build = buildWordDocumentArgs(paragraphs);
    const outline = build.args.heading_outline;

    expect(outline.startsWith("Headings beyond the included text:")).toBe(true);
    expect(bytes(outline)).toBeLessThanOrEqual(HEADING_OUTLINE_BUDGET_BYTES);
    expect(outline).not.toContain("[1|H1]");
    const sent = Number(build.args.paragraphs_sent);
    for (const line of outline.split("\n").slice(1)) {
      const ordinal = Number(/^\[(\d+)\|/.exec(line)?.[1]);
      expect(ordinal).toBeGreaterThan(sent);
    }
  });

  it("leaves the outline empty when nothing was truncated", () => {
    const build = buildWordDocumentArgs([
      paragraph(1, "Title", { styleBuiltIn: "Heading1" }),
      paragraph(2, "Body"),
    ]);
    expect(build.args.heading_outline).toBe("");
  });

  it("reports an all-empty document as having no content", () => {
    const build = buildWordDocumentArgs([paragraph(1, ""), paragraph(2, "  ")]);

    expect(build.coverage.hasContent).toBe(false);
    expect(build.args.document_text).toBe("");
    expect(build.args.paragraphs_sent).toBe("2");
    expect(build.args.paragraphs_total).toBe("2");
  });

  it("handles an empty document", () => {
    const build = buildWordDocumentArgs([]);
    expect(build.args.paragraphs_total).toBe("0");
    expect(build.coverage.hasContent).toBe(false);
    expect(build.coverage.truncated).toBe(false);
  });
});

describe("resolveHeadingLevel", () => {
  it("prefers the built-in style", () => {
    expect(
      resolveHeadingLevel({ styleBuiltIn: "Heading4", outlineLevel: 10 }),
    ).toBe(4);
    expect(
      resolveHeadingLevel({ styleBuiltIn: "Title", outlineLevel: 10 }),
    ).toBe(1);
  });

  it("falls back to the outline level only inside 1..9", () => {
    expect(
      resolveHeadingLevel({ styleBuiltIn: "Other", outlineLevel: 2 }),
    ).toBe(2);
    expect(
      resolveHeadingLevel({ styleBuiltIn: "Normal", outlineLevel: 10 }),
    ).toBeNull();
    expect(
      resolveHeadingLevel({ styleBuiltIn: "Normal", outlineLevel: 0 }),
    ).toBeNull();
  });
});

describe("cutToUtf8Bytes", () => {
  it("never splits a multi-byte sequence", () => {
    expect(cutToUtf8Bytes("äää", 3)).toBe("ä");
    expect(cutToUtf8Bytes("😀😀", 5)).toBe("😀");
    expect(cutToUtf8Bytes("abc", 0)).toBe("");
    expect(cutToUtf8Bytes("abc", 10)).toBe("abc");
  });
});

describe("normalizeParagraphText", () => {
  it("collapses runs of break characters and trims", () => {
    expect(normalizeParagraphText(`  a\u000B\u000Bb  `)).toBe("a b");
  });
});
