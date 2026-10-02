import {
  WORDPROCESSING_NS as W,
  readWordParagraphFormatting,
  readWordRunFormatting,
} from "./wordBlockFormatting";

import type {
  WordParagraphFormatting,
  WordRunFormatting,
} from "./wordBlockFormatting";

const A = "http://schemas.openxmlformats.org/drawingml/2006/main";

/** What a paragraph style looks like once basedOn and the document defaults apply: the values a block
 * inherits when its plan sets no format. Read-only metadata, in the plan's own vocabulary. */
export type WordStyleLook = Pick<
  WordParagraphFormatting,
  | "alignment"
  | "spacingBefore"
  | "spacingAfter"
  | "lineSpacing"
  | "indentLeft"
  | "indentRight"
  | "firstLineIndent"
  | "keepNext"
  | "keepTogether"
  | "pageBreakBefore"
  | "widowControl"
> & {
  font?: Pick<
    WordRunFormatting,
    | "fontFamily"
    | "fontSize"
    | "color"
    | "bold"
    | "italic"
    | "underline"
    | "caps"
    | "smallCaps"
  >;
};

const PARAGRAPH_KEYS = [
  "alignment",
  "spacingBefore",
  "spacingAfter",
  "lineSpacing",
  "indentLeft",
  "indentRight",
  "firstLineIndent",
  "keepNext",
  "keepTogether",
  "pageBreakBefore",
  "widowControl",
] as const;
const FONT_KEYS = [
  "fontFamily",
  "fontSize",
  "color",
  "bold",
  "italic",
  "underline",
  "caps",
  "smallCaps",
] as const;

const child = (parent: Element | undefined, name: string) =>
  Array.from(parent?.children ?? []).find(
    (e) => e.namespaceURI === W && e.localName === name,
  );
const val = (e: Element | undefined, name = "val") =>
  e?.getAttributeNS(W, name) ?? "";

/** The theme's heading and body typefaces, which rFonts may name instead of a font. */
function themeFonts(doc: Document): { major?: string; minor?: string } {
  const scheme = doc.getElementsByTagNameNS(A, "fontScheme")[0];
  const typeface = (name: string) =>
    Array.from(scheme?.getElementsByTagNameNS(A, name) ?? [])[0]
      ?.getElementsByTagNameNS(A, "latin")[0]
      ?.getAttribute("typeface") || undefined;
  return { major: typeface("majorFont"), minor: typeface("minorFont") };
}

/** Looks of every paragraph style in a package (or a bare styles part), keyed by style ID. */
export function wordParagraphStyleLooks(
  doc: Document,
): Map<string, WordStyleLook> {
  const styles = doc.getElementsByTagNameNS(W, "styles")[0];
  const looks = new Map<string, WordStyleLook>();
  if (!styles) return looks;
  const theme = themeFonts(doc);
  const paragraphStyles = Array.from(styles.children).filter(
    (e) =>
      e.namespaceURI === W &&
      e.localName === "style" &&
      val(e, "type") === "paragraph",
  );
  const byId = new Map(paragraphStyles.map((s) => [val(s, "styleId"), s]));
  const defaults = child(styles, "docDefaults");
  const layers = (style: Element) => {
    const chain: Element[] = [];
    for (
      let current: Element | undefined = style;
      current && chain.length < 32 && !chain.includes(current);
      current = byId.get(val(child(current, "basedOn")))
    )
      chain.unshift(current);
    return [
      {
        pPr: child(child(defaults, "pPrDefault"), "pPr"),
        rPr: child(child(defaults, "rPrDefault"), "rPr"),
      },
      ...chain.map((s) => ({ pPr: child(s, "pPr"), rPr: child(s, "rPr") })),
    ];
  };
  for (const [id, style] of byId) {
    let paragraph: WordParagraphFormatting = {};
    let font: WordRunFormatting = {};
    for (const { pPr, rPr } of layers(style)) {
      paragraph = { ...paragraph, ...readWordParagraphFormatting(pPr) };
      font = { ...font, ...readWordRunFormatting(rPr) };
      const fonts = child(rPr, "rFonts");
      const themed = val(fonts, "asciiTheme") || val(fonts, "hAnsiTheme");
      if (themed && !val(fonts, "ascii") && !val(fonts, "hAnsi")) {
        const family = themed.startsWith("major") ? theme.major : theme.minor;
        if (family) font = { ...font, fontFamily: family };
      }
    }
    const look: WordStyleLook = {};
    for (const key of PARAGRAPH_KEYS)
      if (paragraph[key] !== undefined && paragraph[key] !== false)
        Object.assign(look, { [key]: paragraph[key] });
    const visible: NonNullable<WordStyleLook["font"]> = {};
    for (const key of FONT_KEYS)
      if (font[key] !== undefined && font[key] !== false)
        Object.assign(visible, { [key]: font[key] });
    if (Object.keys(visible).length) look.font = visible;
    looks.set(id, look);
  }
  return looks;
}

/** OOXML's values for properties no level of the style chain sets. */
const UNSET_PARAGRAPH: Partial<
  Record<(typeof PARAGRAPH_KEYS)[number], unknown>
> = {
  alignment: "left",
  spacingBefore: 0,
  spacingAfter: 0,
  indentLeft: 0,
  indentRight: 0,
  firstLineIndent: 0,
  lineSpacing: { value: 1, rule: "multiple" },
  keepNext: false,
  keepTogether: false,
  pageBreakBefore: false,
  widowControl: false,
};
const UNSET_FONT: Partial<Record<(typeof FONT_KEYS)[number], unknown>> = {
  bold: false,
  italic: false,
  underline: false,
  caps: false,
  smallCaps: false,
};

const same = (a: unknown, b: unknown): boolean =>
  typeof a === "number" && typeof b === "number"
    ? Math.abs(a - b) < 0.01
    : typeof a === "string" && typeof b === "string"
      ? a.toLowerCase() === b.toLowerCase()
      : a !== null &&
          b !== null &&
          typeof a === "object" &&
          typeof b === "object"
        ? Object.keys({ ...a, ...b }).every((key) =>
            same(
              (a as Record<string, unknown>)[key],
              (b as Record<string, unknown>)[key],
            ),
          )
        : a === b;

/** The format without values the style already gives: they change nothing visible, yet as direct
 * formatting they would stop following the style and keep a rewrite from being written in place. */
export function withoutStyleRedundantFormat(
  format: WordParagraphFormatting,
  look: WordStyleLook,
): WordParagraphFormatting | undefined {
  const result: WordParagraphFormatting = { ...format };
  for (const key of PARAGRAPH_KEYS) {
    const inherited = look[key] ?? UNSET_PARAGRAPH[key];
    if (
      key in result &&
      inherited !== undefined &&
      same(result[key], inherited)
    )
      delete result[key];
  }
  if (result.font) {
    const font: WordRunFormatting = { ...result.font };
    for (const key of FONT_KEYS) {
      const inherited = look.font?.[key] ?? UNSET_FONT[key];
      if (key in font && inherited !== undefined && same(font[key], inherited))
        delete font[key];
    }
    if (Object.keys(font).length) result.font = font;
    else delete result.font;
  }
  return Object.keys(result).length ? result : undefined;
}
