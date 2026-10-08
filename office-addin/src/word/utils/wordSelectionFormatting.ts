/** WordApi 1.1 font properties, set explicitly on the rewritten text on every host. */
export const WORD_SELECTION_FONT_PROPERTIES = [
  "bold",
  "italic",
  "underline",
  "strikeThrough",
  "superscript",
  "subscript",
  "color",
  "highlightColor",
  "name",
  "size",
] as const;

/** The complex-script twins; they can only be set with WordApiDesktop 1.3. */
export const WORD_SELECTION_BIDI_FONT_PROPERTIES = [
  "boldBidirectional",
  "italicBidirectional",
  "sizeBidirectional",
  "nameBidirectional",
] as const;

export type WordSelectionFontProperty =
  | (typeof WORD_SELECTION_FONT_PROPERTIES)[number]
  | (typeof WORD_SELECTION_BIDI_FONT_PROPERTIES)[number];

export type WordSelectionFontValue = string | number | boolean | null;

/** As read from Word.Font; a property left out was not read. */
export type WordSelectionFont = Partial<
  Record<WordSelectionFontProperty, WordSelectionFontValue>
>;

export function wordSelectionTrackedFontProperties(
  bidiSetters: boolean,
): readonly WordSelectionFontProperty[] {
  return bidiSetters
    ? [
        ...WORD_SELECTION_FONT_PROPERTIES,
        ...WORD_SELECTION_BIDI_FONT_PROPERTIES,
      ]
    : WORD_SELECTION_FONT_PROPERTIES;
}

/**
 * Word reports a property that varies across the range as null, underline also as "Mixed", and
 * text values also as "". highlightColor is the exception: null means no highlight and "" means
 * mixed.
 */
export function isUniformFontValue(
  property: WordSelectionFontProperty,
  value: WordSelectionFontValue | undefined,
): boolean {
  if (value === undefined) return false;
  if (property === "highlightColor") return value !== "";
  if (value === null) return false;
  if (property === "underline") return value !== "Mixed";
  return typeof value !== "string" || value !== "";
}

export interface WordSelectionTargetFormat {
  /** A value for every tracked property that resolved. */
  font: WordSelectionFont;
  /** Neither the span nor the paragraph style gave a value; the write must not go ahead. */
  unresolved: WordSelectionFontProperty[];
}

/**
 * Each tracked property takes the value that was uniform across the replaced span, else the
 * paragraph style's. Setting all of them explicitly gives the same result on every host: desktop
 * would otherwise copy the first replaced character's formatting and web would write plain text.
 */
export function wordSelectionTargetFormat(
  span: WordSelectionFont,
  style: WordSelectionFont,
  bidiSetters: boolean,
): WordSelectionTargetFormat {
  const font: WordSelectionFont = {};
  const unresolved: WordSelectionFontProperty[] = [];
  for (const property of wordSelectionTrackedFontProperties(bidiSetters)) {
    const source = isUniformFontValue(property, span[property])
      ? span
      : isUniformFontValue(property, style[property])
        ? style
        : null;
    if (source) font[property] = source[property] ?? null;
    else unresolved.push(property);
  }
  return { font, unresolved };
}
