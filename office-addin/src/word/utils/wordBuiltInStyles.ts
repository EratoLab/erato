// Localized Word changes style IDs (e.g. "berschrift2") but keeps the canonical
// English w:name of built-in styles, so both are checked.
export const isBuiltInHeadingStyle = (
  styleId: string,
  name: string,
  level: number,
) =>
  styleId.toLowerCase() === `heading${level}` ||
  name.toLowerCase() === `heading ${level}`;

export const isDefaultTableStyle = (styleId: string, name: string) =>
  styleId.toLowerCase() === "tablenormal" ||
  name.toLowerCase() === "normal table";

export type WordBuiltInParagraphStyle = Word.Paragraph["styleBuiltIn"];

/** Paragraph.styleBuiltIn values, keyed by the canonical w:name every locale keeps. */
const BUILT_IN_PARAGRAPH_STYLES: Record<string, WordBuiltInParagraphStyle> = {
  normal: "Normal",
  title: "Title",
  subtitle: "Subtitle",
  quote: "Quote",
  "intense quote": "IntenseQuote",
  "no spacing": "NoSpacing",
  "list paragraph": "ListParagraph",
  caption: "Caption",
  "toc heading": "TocHeading",
  bibliography: "Bibliography",
  header: "Header",
  footer: "Footer",
  "footnote text": "FootnoteText",
  "endnote text": "EndnoteText",
};

/** The locale-independent Paragraph.styleBuiltIn name of a paragraph style, if Word has one. */
export function wordBuiltInParagraphStyle(
  styleId: string,
  name: string,
): WordBuiltInParagraphStyle | undefined {
  for (let level = 1; level <= 9; level++)
    if (isBuiltInHeadingStyle(styleId, name, level))
      return `Heading${level}` as WordBuiltInParagraphStyle;
  const toc = /^toc ([1-9])$/i.exec(name);
  if (toc) return `Toc${toc[1]}` as WordBuiltInParagraphStyle;
  return BUILT_IN_PARAGRAPH_STYLES[name.toLowerCase()];
}
