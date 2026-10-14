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

/** A Paragraph.styleBuiltIn value (Office.js Word.BuiltInStyleName) that a canonical style name maps to. */
export type WordBuiltInParagraphStyle =
  | "Normal"
  | "Title"
  | "Subtitle"
  | "Quote"
  | "IntenseQuote"
  | "NoSpacing"
  | "ListParagraph"
  | "Caption"
  | "TocHeading"
  | "Bibliography"
  | "Header"
  | "Footer"
  | "FootnoteText"
  | "EndnoteText"
  | `Heading${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`
  | `Toc${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`;

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

/** The locale-independent Paragraph.styleBuiltIn name of a paragraph style, if Word has one. Word
 * goes by the w:name alone: a custom style with ID "Heading2" is no built-in heading, and setting
 * the built-in one makes Word add its own and rename the document's (ERMAIN-973). */
export function wordBuiltInParagraphStyle(
  name: string,
): WordBuiltInParagraphStyle | undefined {
  const heading = /^heading ([1-9])$/i.exec(name);
  if (heading) return `Heading${heading[1]}` as WordBuiltInParagraphStyle;
  const toc = /^toc ([1-9])$/i.exec(name);
  if (toc) return `Toc${toc[1]}` as WordBuiltInParagraphStyle;
  return BUILT_IN_PARAGRAPH_STYLES[name.toLowerCase()];
}
