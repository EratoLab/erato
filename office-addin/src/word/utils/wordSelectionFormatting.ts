/** Run properties Word switches on or off: b, i, u, strike and vertAlign in OOXML. */
export const WORD_SELECTION_TOGGLE_PROPERTIES = [
  "bold",
  "italic",
  "underline",
  "strikeThrough",
  "superscript",
  "subscript",
] as const;

/** Run properties that carry a value: color, highlight, the ascii font and sz in OOXML. */
export const WORD_SELECTION_VALUE_PROPERTIES = [
  "color",
  "highlightColor",
  "name",
  "size",
] as const;

/** WordApi 1.1 font properties the rewrite can set. */
export const WORD_SELECTION_FONT_PROPERTIES = [
  ...WORD_SELECTION_TOGGLE_PROPERTIES,
  ...WORD_SELECTION_VALUE_PROPERTIES,
] as const;

/** The complex-script twins of the toggles that have one; they can only be set with WordApiDesktop 1.3. */
export const WORD_SELECTION_BIDI_TWINS = {
  bold: "boldBidirectional",
  italic: "italicBidirectional",
} as const;

export type WordSelectionToggleProperty =
  (typeof WORD_SELECTION_TOGGLE_PROPERTIES)[number];

export type WordSelectionSpanProperty =
  (typeof WORD_SELECTION_FONT_PROPERTIES)[number];

export type WordSelectionFontProperty =
  | WordSelectionSpanProperty
  | (typeof WORD_SELECTION_BIDI_TWINS)[keyof typeof WORD_SELECTION_BIDI_TWINS];

export type WordSelectionFontValue = string | number | boolean | null;

/** Values in Word.Font terms; a property left out is not set. */
export type WordSelectionFont = Partial<
  Record<WordSelectionFontProperty, WordSelectionFontValue>
>;

/**
 * A run property as the span's own OOXML gives it: the same direct value on every run, or direct
 * on some runs only or with different values. A property direct on no run, which includes an
 * automatic colour, is left out.
 */
export type WordSelectionRunProperty =
  | { state: "direct"; value: WordSelectionFontValue }
  | { state: "mixed" };

export type WordSelectionSpanFormat = Partial<
  Record<WordSelectionSpanProperty, WordSelectionRunProperty>
>;

export interface WordSelectionTargetFormat {
  /** To set on the range insertText returns; anything left out keeps what the host writes. */
  font: WordSelectionFont;
  /**
   * Mixed properties the write cannot make the same on every host: a value property, or a toggle
   * the paragraph style gave no value for. The selection must be context only.
   */
  unresolved: WordSelectionSpanProperty[];
}

/**
 * Re-sets only what the span sets directly. A mixed toggle takes the paragraph style's value,
 * because desktop would copy the first character's and the web writes none; a mixed colour,
 * highlight, font or size has no such value (automatic colour cannot be set), so it is unresolved.
 */
export function wordSelectionTargetFormat(
  span: WordSelectionSpanFormat,
  style: WordSelectionFont,
  bidiSetters: boolean,
): WordSelectionTargetFormat {
  const font: WordSelectionFont = {};
  const unresolved: WordSelectionSpanProperty[] = [];
  for (const property of WORD_SELECTION_FONT_PROPERTIES) {
    const run = span[property];
    if (run?.state === "direct") {
      font[property] = run.value;
      continue;
    }
    if (run?.state !== "mixed") continue;
    const value = isToggle(property) ? style[property] : undefined;
    if (value === undefined || value === null) {
      unresolved.push(property);
      continue;
    }
    font[property] = value;
    // Desktop otherwise keeps the first character's bCs or iCs on the whole rewrite.
    const twin = (
      WORD_SELECTION_BIDI_TWINS as Partial<
        Record<string, WordSelectionFontProperty>
      >
    )[property];
    if (twin && bidiSetters) font[twin] = value;
  }
  return { font, unresolved };
}

function isToggle(
  property: WordSelectionSpanProperty,
): property is WordSelectionToggleProperty {
  return (WORD_SELECTION_TOGGLE_PROPERTIES as readonly string[]).includes(
    property,
  );
}
