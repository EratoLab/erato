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
 * goes by the w:name alone, whose aliases follow a comma ("heading 2,h2"): a custom style with ID
 * "Heading2" is no built-in heading, and setting the built-in one makes Word add its own and rename
 * the document's (ERMAIN-973). */
export function wordBuiltInParagraphStyle(
  name: string,
): WordBuiltInParagraphStyle | undefined {
  const own = name.split(",", 1)[0];
  const heading = /^heading ([1-9])$/i.exec(own);
  if (heading) return `Heading${heading[1]}` as WordBuiltInParagraphStyle;
  const toc = /^toc ([1-9])$/i.exec(own);
  if (toc) return `Toc${toc[1]}` as WordBuiltInParagraphStyle;
  return BUILT_IN_PARAGRAPH_STYLES[own.toLowerCase()];
}

/** The paragraph style a heading of `level` compiles to: Word's built-in heading by its canonical
 * name, which localized Word keeps under another ID (e.g. "berschrift2"), else a style with the
 * built-in heading's ID. */
export function wordHeadingStyle<T extends { id: string; name: string }>(
  paragraphStyles: readonly T[],
  level: number,
): T | undefined {
  return (
    paragraphStyles.find(
      (style) => wordBuiltInParagraphStyle(style.name) === `Heading${level}`,
    ) ??
    paragraphStyles.find(
      (style) => style.id.toLowerCase() === `heading${level}`,
    )
  );
}
