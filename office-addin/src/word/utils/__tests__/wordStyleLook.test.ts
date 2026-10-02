import { describe, expect, it } from "vitest";

import {
  realisticSnapshot,
  realisticWordPackageXml,
  statusRewritePlan,
} from "../../../test/mocks/word/realisticWordFixtures";
import {
  wordReadableStyles,
  wordStyleNamesBytes,
} from "../wordAuthoringReadData";
import { normalizeWordDocumentPlan } from "../wordDocumentPlan";
import {
  captureWordAuthoringSnapshot,
  compileWordDocumentPlan,
} from "../wordDocumentXml";
import { ALL_WORD_IN_PLACE_CAPABILITIES } from "../wordInPlaceCapabilities";
import { classifyWordInPlacePlan } from "../wordInPlacePlan";
import { wordScopedReadContract } from "../wordScopedReadContract";
import {
  withoutStyleRedundantFormat,
  wordParagraphStyleLooks,
} from "../wordStyleLook";

import type { WordParagraphFormatting } from "../wordBlockFormatting";
import type { WordDocumentPlan } from "../wordDocumentPlan";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const PKG = "http://schemas.microsoft.com/office/2006/xmlPackage";
const parse = (xml: string) =>
  new DOMParser().parseFromString(xml, "application/xml");

/** A styles part next to a theme, as a package carries them. */
const stylesPackage = (styles: string) =>
  parse(
    `<pkg:package xmlns:pkg="${PKG}"><pkg:part pkg:name="/word/styles.xml"><pkg:xmlData><w:styles xmlns:w="${W}">${styles}</w:styles></pkg:xmlData></pkg:part><pkg:part pkg:name="/word/theme/theme1.xml"><pkg:xmlData><a:theme xmlns:a="${A}"><a:themeElements><a:fontScheme><a:majorFont><a:latin typeface="Aptos Display"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/></a:minorFont></a:fontScheme></a:themeElements></a:theme></pkg:xmlData></pkg:part></pkg:package>`,
  );

describe("Word style looks", () => {
  it("resolves a style through basedOn, the document defaults and the theme fonts", () => {
    const looks = wordParagraphStyleLooks(
      stylesPackage(
        `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
          `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
          `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="80"/></w:pPr><w:rPr><w:rFonts w:asciiTheme="majorHAnsi" w:hAnsiTheme="majorHAnsi"/><w:b/><w:color w:val="0F4761" w:themeColor="accent1" w:themeShade="BF"/><w:sz w:val="40"/></w:rPr></w:style>` +
          `<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Heading1"/><w:pPr><w:keepNext w:val="0"/></w:pPr><w:rPr><w:b w:val="0"/><w:sz w:val="32"/></w:rPr></w:style>`,
      ),
    );
    expect(looks.get("Normal")).toEqual({
      spacingAfter: 8,
      lineSpacing: { value: 1.15, rule: "multiple" },
      font: { fontFamily: "Aptos", fontSize: 11 },
    });
    expect(looks.get("Heading1")).toEqual({
      spacingBefore: 18,
      spacingAfter: 4,
      lineSpacing: { value: 1.15, rule: "multiple" },
      keepNext: true,
      font: {
        fontFamily: "Aptos Display",
        fontSize: 20,
        color: "0F4761",
        bold: true,
      },
    });
    // A style that switches an inherited property off shows nothing for it.
    expect(looks.get("Heading2")).toEqual({
      spacingBefore: 18,
      spacingAfter: 4,
      lineSpacing: { value: 1.15, rule: "multiple" },
      font: { fontFamily: "Aptos Display", fontSize: 16, color: "0F4761" },
    });
  });

  it("leaves out only the format values the style already gives", () => {
    const look = {
      spacingAfter: 4,
      keepNext: true,
      font: { fontSize: 16, color: "0F4761" },
    };
    expect(
      withoutStyleRedundantFormat(
        {
          spacingAfter: 4,
          keepNext: true,
          pageBreakBefore: false,
          font: { fontSize: 16, color: "0f4761", bold: false },
        },
        look,
      ),
    ).toBeUndefined();
    expect(
      withoutStyleRedundantFormat(
        {
          spacingAfter: 4,
          spacingBefore: 6,
          pageBreakBefore: true,
          font: { fontSize: 12 },
        },
        look,
      ),
    ).toEqual({
      spacingBefore: 6,
      pageBreakBefore: true,
      font: { fontSize: 12 },
    });
  });

  it("shows the look of the styles the body uses, and names only for the rest", () => {
    const snapshot = realisticSnapshot(
      realisticWordPackageXml().replace(
        "</w:styles>",
        `<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/></w:pPr></w:style></w:styles>`,
      ),
    );
    const readable = wordReadableStyles(snapshot.styles);
    const style = (id: string) => readable.find((s) => s.id === id);
    expect(style("Normal")).toMatchObject({ default: true, look: {} });
    expect(style("Heading1")?.look).toMatchObject({
      spacingBefore: 12,
      spacingAfter: 0,
      keepNext: true,
      font: { bold: true, fontSize: 16 },
    });
    expect(style("Quote")).toEqual({
      id: "Quote",
      name: "Quote",
      type: "paragraph",
    });
    expect(readable.some((s) => "inUse" in s)).toBe(false);
    // The 16 KiB catalogue limit counts names, not looks.
    expect(wordStyleNamesBytes(snapshot.styles)).toBe(
      new TextEncoder().encode(
        JSON.stringify(
          snapshot.styles.map(({ id, name, type, default: d }) => ({
            id,
            name,
            type,
            ...(d ? { default: d } : {}),
          })),
        ),
      ).length,
    );
    // A scoped read always carries the default style, which every plain paragraph has.
    expect(
      wordScopedReadContract(snapshot, []).styles.map((s) => s.id),
    ).toEqual(["Normal"]);
  });

  it("drops a restated style look from a plan so the rewrite can stay in place", () => {
    const snapshot = realisticSnapshot(realisticWordPackageXml());
    const withFormat = (format: WordParagraphFormatting): WordDocumentPlan => {
      const plan = statusRewritePlan(snapshot, "Status: revised.");
      const entry = plan.entries[1];
      if (entry.kind !== "replace")
        throw new Error("Expected a replace entry.");
      entry.blocks = [
        { id: "status", type: "paragraph", text: "Status: revised.", format },
      ];
      return plan;
    };
    const route = (plan: WordDocumentPlan) => {
      const normalized = normalizeWordDocumentPlan(plan, snapshot);
      const compiled = captureWordAuthoringSnapshot(
        compileWordDocumentPlan(normalized, snapshot),
        snapshot.identity,
        "Off",
        true,
        "verify",
      );
      const result = classifyWordInPlacePlan(
        normalized,
        snapshot,
        ALL_WORD_IN_PLACE_CAPABILITIES,
        compiled,
      );
      return {
        format: (normalized.entries[1] as { blocks: { format?: unknown }[] })
          .blocks[0].format,
        route: "fallback" in result ? result.fallback : "in-place",
      };
    };
    // The document defaults give Normal 8 pt after, 11 pt text and no page break.
    expect(
      route(
        withFormat({
          spacingAfter: 8,
          pageBreakBefore: false,
          font: { fontSize: 11, bold: false },
        }),
      ),
    ).toEqual({ format: undefined, route: "in-place" });
    expect(
      route(withFormat({ spacingAfter: 6, font: { fontSize: 11 } })),
    ).toEqual({ format: { spacingAfter: 6 }, route: "format" });
  });
});
