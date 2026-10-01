import { describe, expect, it } from "vitest";

import {
  applyWordParagraphFormatting,
  applyWordRunFormatting,
  parseWordBorders,
  parseWordParagraphFormatting,
  parseWordRunFormatting,
  readWordParagraphFormatting,
  readWordRunFormatting,
  wordAttribute,
  wordChild,
  WORDPROCESSING_NS as W,
} from "../wordBlockFormatting";

const props = (name: string, contents = "") =>
  new DOMParser().parseFromString(
    `<w:${name} xmlns:w="${W}" xmlns:x="urn:test">${contents}</w:${name}>`,
    "application/xml",
  ).documentElement;

describe("typed Word direct formatting", () => {
  it("uses points for typography, character spacing, indentation and paragraph spacing", () => {
    const p = props("pPr");
    const format = parseWordParagraphFormatting({
      alignment: "justify",
      spacingBefore: 6,
      spacingAfter: 12,
      lineSpacing: { value: 1.5, rule: "multiple" },
      indentLeft: 18,
      indentRight: 9,
      firstLineIndent: -9,
      keepNext: false,
      keepTogether: true,
      font: {
        fontSize: 10.5,
        fontFamily: "Aptos",
        color: "#1a2b3c",
        characterSpacing: 0.5,
      },
    })!;
    applyWordParagraphFormatting(p, format);
    expect(wordAttribute(wordChild(p, "jc"))).toBe("both");
    expect(wordAttribute(wordChild(p, "spacing"), "before")).toBe("120");
    expect(wordAttribute(wordChild(p, "spacing"), "line")).toBe("360");
    expect(wordAttribute(wordChild(p, "spacing"), "lineRule")).toBe("auto");
    expect(wordAttribute(wordChild(p, "ind"), "hanging")).toBe("180");
    expect(wordAttribute(wordChild(wordChild(p, "rPr"), "sz"))).toBe("21");
    expect(readWordParagraphFormatting(p)).toEqual(format);
  });

  it.each(["exact", "atLeast"] as const)(
    "writes %s line heights in twentieths of a point",
    (rule) => {
      const p = props("pPr");
      applyWordParagraphFormatting(p, { lineSpacing: { value: 14, rule } });
      expect(wordAttribute(wordChild(p, "spacing"), "line")).toBe("280");
      expect(readWordParagraphFormatting(p).lineSpacing).toEqual({
        value: 14,
        rule,
      });
    },
  );

  it("explicitly turns inherited marks off and changes highlighting, strike and baseline", () => {
    const r = props(
      "rPr",
      '<w:b/><w:i/><w:u w:val="double"/><w:rFonts w:asciiTheme="minorHAnsi"/><w:color w:themeColor="accent1" w:val="112233"/>',
    );
    const format = parseWordRunFormatting(
      {
        text: "sample",
        bold: false,
        italic: false,
        underline: false,
        strike: true,
        caps: false,
        smallCaps: true,
        highlight: "none",
        shading: "#aBcDeF",
        fontFamily: "Aptos",
        fontSize: 11,
        verticalAlign: "baseline",
        language: "de-DE",
        color: "auto",
      },
      ["text"],
    )!;
    applyWordRunFormatting(r, format);
    expect(wordAttribute(wordChild(r, "b"))).toBe("0");
    expect(wordAttribute(wordChild(r, "u"))).toBe("none");
    expect(wordChild(r, "rFonts")?.hasAttributeNS(W, "asciiTheme")).toBe(false);
    expect(wordChild(r, "color")?.hasAttributeNS(W, "themeColor")).toBe(false);
    expect(readWordRunFormatting(r)).toEqual(format);
  });

  it("updates requested properties and keeps unowned formatting and extension metadata", () => {
    const p = props(
      "pPr",
      '<w:spacing w:before="20" w:after="120" w:beforeLines="100" w:beforeAutospacing="1" x:marker="kept"/><w:ind w:left="300" w:start="400" w:leftChars="20" w:right="900"/><x:custom x:important="yes"/>',
    );
    applyWordParagraphFormatting(p, { spacingBefore: 10, indentLeft: 18 });
    const spacing = wordChild(p, "spacing")!;
    expect(wordAttribute(spacing, "after")).toBe("120");
    expect(spacing.getAttributeNS("urn:test", "marker")).toBe("kept");
    expect(spacing.hasAttributeNS(W, "beforeLines")).toBe(false);
    expect(spacing.hasAttributeNS(W, "beforeAutospacing")).toBe(false);
    expect(wordAttribute(wordChild(p, "ind"), "right")).toBe("900");
    expect(p.getElementsByTagNameNS("urn:test", "custom")).toHaveLength(1);
  });

  it("orders OOXML paragraph/run properties and converts borders to eighth points", () => {
    const p = props("pPr", '<w:pStyle w:val="Normal"/><w:sectPr/>');
    applyWordParagraphFormatting(p, {
      alignment: "center",
      keepNext: true,
      shading: "EEEEEE",
      borders: {
        top: { style: "single", width: 0.5, color: "112233", space: 3 },
        bottom: { style: "none" },
      },
      font: { fontSize: 12, bold: true, color: "121212" },
    });
    expect(Array.from(p.children).map((e) => e.localName)).toEqual([
      "pStyle",
      "keepNext",
      "pBdr",
      "shd",
      "jc",
      "rPr",
      "sectPr",
    ]);
    expect(
      Array.from(wordChild(p, "rPr")!.children).map((e) => e.localName),
    ).toEqual(["b", "color", "sz", "szCs"]);
    expect(wordAttribute(wordChild(wordChild(p, "pBdr"), "top"), "sz")).toBe(
      "4",
    );
    expect(readWordParagraphFormatting(p).borders?.bottom?.style).toBe("none");
  });

  it.each([
    { fontSize: 12.1 },
    { fontSize: -1 },
    { fontSize: Infinity },
    { fontFamily: "Aptos\u0000" },
    { color: "red" },
    { color: "#123" },
    { highlight: "#ff0000" },
    { language: "../xml" },
    { underline: false, underlineStyle: "double" },
    { bold: "yes" },
    { html: "<b>hello</b>" },
  ])("rejects invalid or untyped run properties %#", (value) => {
    expect(parseWordRunFormatting(value)).toBeNull();
  });

  it.each([
    { alignment: "middle" },
    { spacingBefore: -1 },
    { font: { fontSize: 12.1 } },
    { lineSpacing: { value: 20, rule: "multiple" } },
    { lineSpacing: { value: 1.5, rule: "auto" } },
    { borders: { insideH: { style: "single" } } },
    { borders: { top: { style: "single", width: 0.1 } } },
    { pageBreakBefore: "false" },
    { pPr: "<w:sectPr/>" },
  ])("rejects invalid paragraph controls %#", (value) => {
    expect(parseWordParagraphFormatting(value)).toBeNull();
  });

  it("requires known border sides and styles and supports a precise clear", () => {
    expect(parseWordBorders({ top: { style: "none" } })).toEqual({
      top: { style: "none" },
    });
    expect(parseWordBorders({ all: { style: "single" } })).toBeNull();
    expect(parseWordBorders({ top: { style: "script" } })).toBeNull();
  });

  it("writes border sides in schema order independent of model key order", () => {
    const p = props("pPr");
    applyWordParagraphFormatting(p, {
      borders: {
        bottom: { style: "single" },
        right: { style: "dotted" },
        top: { style: "single" },
        left: { style: "single" },
      },
    });
    expect(
      Array.from(wordChild(p, "pBdr")!.children).map((e) => e.localName),
    ).toEqual(["top", "left", "bottom", "right"]);
  });
});
