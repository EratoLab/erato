import {
  alignWordParagraph,
  markWordSelectionPart,
  wordParagraphElement,
  wordPartBoundaries,
} from "./wordSelectionItems";
import { wordRunEmphasis } from "./wordSelectionSpan";

import type { WordSelectionFont } from "./wordSelectionFormatting";
import type {
  WordAlignedParagraph,
  WordMarkedPart,
  WordPartBoundary,
} from "./wordSelectionItems";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

/** Bold, italic, underline and strikethrough in Word.Font terms: what a format span keeps. */
export interface WordEmphasis {
  bold?: boolean;
  italic?: boolean;
  /** A Word.UnderlineType, "None" included. */
  underline?: string;
  strikeThrough?: boolean;
}

const EMPHASIS_KEYS = ["bold", "italic", "underline", "strikeThrough"] as const;

type WordEmphasisKey = (typeof EMPHASIS_KEYS)[number];

/**
 * The most format spans one paragraph's part gets (ERMAIN-943). A part with more gets none, and a
 * rewrite gives all of its text the formatting it shares, as before format spans.
 */
export const WORD_FORMAT_SPANS_MAX = 6;

/** Text of a part whose emphasis differs from the rest of its piece, in paragraph.text offsets. */
export interface WordFormatRange {
  start: number;
  /** Exclusive. */
  end: number;
  /** Only the toggles the rest of the piece does not share. */
  emphasis: WordEmphasis;
  /** The run of its first character, whose own toggles a kept paragraph's rewrite copies. */
  run: Element;
}

/** A format span as the snapshot keeps it: its marker number and what its text keeps. */
export interface WordFormatSpan {
  number: number;
  emphasis: WordEmphasis;
}

const isW = (node: Element, name: string) =>
  node.namespaceURI === W && node.localName === name;

const holdsText = (run: Element) =>
  Array.from(run.children).some((c) => isW(c, "t"));

const propsOf = (run: Element) =>
  Array.from(run.children).find((c) => isW(c, "rPr"));

/**
 * A part's format spans. Per piece between the part's item boundaries, each stretch of text whose
 * bold, italic, underline or strikethrough is not what every text run of the piece has: a rewrite
 * of the piece leaves exactly those toggles to the paragraph's style, and the text outside every
 * span keeps the rest. A run without text of its own, such as a tab alone, is never part of a span,
 * as the span scan never reads it. None when there are more than WORD_FORMAT_SPANS_MAX.
 */
export function wordPartFormatRanges(
  aligned: WordAlignedParagraph,
  start: number,
  end: number,
  part: {
    boundaries: readonly WordPartBoundary[];
    hidden: ReadonlySet<number>;
  },
): WordFormatRange[] {
  const edges = [start, ...part.boundaries.map((b) => b.at), end];
  const ranges: WordFormatRange[] = [];
  for (let k = 0; k + 1 < edges.length; k += 1) {
    const chars: { at: number; run: Element }[] = [];
    for (let at = edges[k]; at < edges[k + 1]; at += 1) {
      const char = aligned.chars[at];
      if (!part.hidden.has(at) && char)
        chars.push({ at, run: char.node.parentNode as Element });
    }
    const own = new Map<Element, WordEmphasis>();
    for (const { run } of chars)
      if (!own.has(run) && holdsText(run))
        own.set(run, wordRunEmphasis(propsOf(run)));
    const values = [...own.values()];
    const differs = EMPHASIS_KEYS.filter((key) =>
      values.some((value) => value[key] !== values[0][key]),
    );
    let current: WordFormatRange | null = null;
    let currentKey = "";
    for (const { at, run } of chars) {
      const emphasis: WordEmphasis = {};
      const toggles = own.get(run);
      if (toggles)
        for (const key of differs)
          if (toggles[key] !== undefined) copy(emphasis, toggles, key);
      const key = JSON.stringify(emphasis);
      if (current && key === currentKey && at === current.end) {
        current.end = at + 1;
        continue;
      }
      current = null;
      if (key === "{}") continue;
      current = { start: at, end: at + 1, emphasis, run };
      currentKey = key;
      ranges.push(current);
    }
  }
  return ranges.length <= WORD_FORMAT_SPANS_MAX ? ranges : [];
}

function copy<K extends WordEmphasisKey>(
  to: WordEmphasis,
  from: WordEmphasis,
  key: K,
) {
  to[key] = from[key];
}

const NO_ITEMS = { items: [], references: [] };

/**
 * The part [start, end) of an aligned paragraph as the model sees it: with ⟦n⟧ markers for its kept
 * items where `items`, and ⟦n⟧…⟦/n⟧ around its format spans where `formats`. Numbers run on from
 * `first` in the order the markers appear. Null where the items' marking refuses the part.
 */
export function markWordParagraphPart(
  aligned: WordAlignedParagraph,
  rangeText: string,
  start: number,
  end: number,
  first: number,
  options: { items: boolean; formats: boolean },
): WordMarkedPart | null {
  const read = options.items ? aligned : NO_ITEMS;
  const part = wordPartBoundaries(rangeText, read, start, end);
  if (!part) return null;
  const ranges = options.formats
    ? wordPartFormatRanges(aligned, start, end, part)
    : [];
  return markWordSelectionPart(rangeText, read, start, end, first, ranges);
}

/** markWordParagraphPart on a paragraph's own OOXML; null when it cannot be read or aligned. */
export function markWordParagraphOoxml(
  ooxml: string,
  rangeText: string,
  start: number,
  end: number,
  first: number,
  options: { items: boolean; formats: boolean },
): WordMarkedPart | null {
  const parsed = wordParagraphElement(ooxml);
  const aligned = parsed && alignWordParagraph(parsed.paragraph, rangeText);
  if (!aligned || "refused" in aligned) return null;
  return markWordParagraphPart(aligned, rangeText, start, end, first, options);
}

/**
 * How kept_items words a span's emphasis. The Erato web app reads these words back
 * (frontend wordSelectionReply.ts), so changing them needs both sides.
 */
export function wordEmphasisWords(emphasis: WordEmphasis): string[] {
  const words: string[] = [];
  if (emphasis.bold !== undefined)
    words.push(emphasis.bold ? "bold" : "not bold");
  if (emphasis.italic !== undefined)
    words.push(emphasis.italic ? "italic" : "not italic");
  if (emphasis.underline !== undefined)
    words.push(emphasis.underline === "None" ? "no underline" : "underline");
  if (emphasis.strikeThrough !== undefined)
    words.push(emphasis.strikeThrough ? "strikethrough" : "no strikethrough");
  return words;
}

/**
 * A span's toggles as the plain path sets them on its text. The complex-script twins follow where
 * they can be set, as wordSelectionTargetFormat gives them; Word for the web's setters write them on
 * their own.
 */
export function wordEmphasisFont(
  emphasis: WordEmphasis,
  bidiSetters: boolean,
): WordSelectionFont {
  const font: WordSelectionFont = { ...emphasis };
  if (bidiSetters && emphasis.bold !== undefined)
    font.boldBidirectional = emphasis.bold;
  if (bidiSetters && emphasis.italic !== undefined)
    font.italicBidirectional = emphasis.italic;
  return font;
}

/** The run properties each toggle is written as, its complex-script twin included. */
const TOGGLE_ELEMENTS: Readonly<Record<WordEmphasisKey, readonly string[]>> = {
  bold: ["b", "bCs"],
  italic: ["i", "iCs"],
  underline: ["u"],
  strikeThrough: ["strike"],
};

/** The order of w:rPr's children in the schema, which Word expects of the properties it reads. */
const RUN_PROPERTY_ORDER = [
  "rStyle",
  "rFonts",
  "b",
  "bCs",
  "i",
  "iCs",
  "caps",
  "smallCaps",
  "strike",
  "dstrike",
  "outline",
  "shadow",
  "emboss",
  "imprint",
  "noProof",
  "snapToGrid",
  "vanish",
  "webHidden",
  "color",
  "spacing",
  "w",
  "kern",
  "position",
  "sz",
  "szCs",
  "highlight",
  "u",
  "effect",
  "bdr",
  "shd",
  "fitText",
  "vertAlign",
  "rtl",
  "cs",
  "em",
  "lang",
  "eastAsianLayout",
  "specVanish",
  "oMath",
];

const orderOf = (node: Element) => {
  const at =
    node.namespaceURI === W ? RUN_PROPERTY_ORDER.indexOf(node.localName) : -1;
  return at < 0 ? RUN_PROPERTY_ORDER.length : at;
};

/**
 * The properties for a span's new text in a kept paragraph: `base`, the properties its piece's text
 * runs share, with the span's toggles, twins included, as the run its text came from has them.
 */
export function wordFormatRangeProps(
  base: Element | undefined,
  range: WordFormatRange,
): Element {
  const props =
    (base?.cloneNode(true) as Element | undefined) ??
    range.run.ownerDocument.createElementNS(W, "w:rPr");
  const names = new Set(
    (Object.keys(range.emphasis) as WordEmphasisKey[]).flatMap(
      (key) => TOGGLE_ELEMENTS[key],
    ),
  );
  for (const child of Array.from(props.children))
    if (child.namespaceURI === W && names.has(child.localName)) child.remove();
  for (const toggle of Array.from(propsOf(range.run)?.children ?? [])) {
    if (toggle.namespaceURI !== W || !names.has(toggle.localName)) continue;
    const before = Array.from(props.children).find(
      (child) => orderOf(child) > orderOf(toggle),
    );
    props.insertBefore(toggle.cloneNode(true), before ?? null);
  }
  return props;
}

/** Whether a span's text keeps `property` of its old runs: the span carries that toggle. */
export function wordFormatRangeCarries(
  range: WordFormatRange,
  property: Element,
): boolean {
  return (Object.keys(range.emphasis) as WordEmphasisKey[]).some(
    (key) =>
      property.namespaceURI === W &&
      TOGGLE_ELEMENTS[key].includes(property.localName),
  );
}
