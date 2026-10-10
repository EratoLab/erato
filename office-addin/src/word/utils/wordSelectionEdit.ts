import { splitWordMarkedLine, WORD_MARKER } from "./wordSelectionItems";

import type {
  WordSelectionReplaceCode,
  WordSelectionShape,
} from "./wordSelectionAnchor";
import type { WordFormatSpan } from "./wordSelectionFormatSpans";
import type { WordKeptMarker, WordLinePart } from "./wordSelectionItems";

/** Fence tags are case-sensitive and must match the renderer registration. */
export const WORD_REPLACE_FENCE = "erato-word-replace";

const WORD_REPLACE_FENCE_OPENING = new RegExp(
  `^[^\\S\\n]*(?:\`{3,}|~{3,})[^\\S\\n]*${WORD_REPLACE_FENCE}(?![\\w-])`,
  "gm",
);

/** Replace fences in an answer. Counting a nested or indented one too errs towards several. */
export function countWordReplaceFences(text: string): number {
  return text.match(WORD_REPLACE_FENCE_OPENING)?.length ?? 0;
}

export type WordSelectionReplacement =
  | { lines: string[] }
  | {
      refused: Extract<
        WordSelectionReplaceCode,
        "PARAGRAPH_COUNT_MISMATCH" | "INVALID_REPLACEMENT"
      >;
    };

/**
 * Control characters other than tab and newline: Word reads them as marks, breaks, fields or special
 * hyphens, not text. A reply holding one is refused, and a span holding one is context only, since
 * its rewrite could neither echo nor keep it.
 */
export const WORD_CONTROL_CHARACTER =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/**
 * One line per covered paragraph. Word turns every newline into a new paragraph, so a
 * single-paragraph rewrite has its line breaks joined; a multi-paragraph one must keep exactly one
 * line per paragraph, including empty ones.
 */
export function splitWordSelectionReplacement(
  fenceContent: string,
  shape: WordSelectionShape,
  paragraphCount: number,
): WordSelectionReplacement {
  // insertText turns the Unicode line and paragraph separators into breaks too.
  const text = fenceContent
    .replace(/\r\n?|[\u2028\u2029]/g, "\n")
    .replace(/\n$/, "");
  if (text.trim() === "" || WORD_CONTROL_CHARACTER.test(text))
    return { refused: "INVALID_REPLACEMENT" };
  if (shape !== "multi_paragraph")
    return {
      lines: [text.replace(/^\n+|\n+$/g, "").replace(/[ \t]*\n+[ \t]*/g, " ")],
    };
  const lines = text.split("\n");
  return lines.length === paragraphCount
    ? { lines }
    : { refused: "PARAGRAPH_COUNT_MISMATCH" };
}

/** A covered paragraph's line, split at its markers. */
export interface WordSelectionLine {
  /** The line without format markers; without any marker for a paragraph without items. */
  text: string;
  /** For a paragraph with kept items: its text before, between and after their markers. */
  pieces: string[] | null;
  /** Per piece, its text cut at the format markers, each part with its format span. */
  parts: WordLinePart[][];
}

/**
 * Per covered paragraph, its line split at the markers of the items it keeps and of its format
 * spans. A paragraph without items has one piece; its line must hold no other marker bracket, since
 * it would be written as text. `dropped` lists the format spans the proposal left out or empty.
 */
export function wordSelectionLinePieces(
  paragraphs: readonly {
    kept?: { markers: readonly Pick<WordKeptMarker, "number" | "end">[] };
    formats?: { spans: readonly Pick<WordFormatSpan, "number">[] };
  }[],
  lines: readonly string[],
):
  | { lines: WordSelectionLine[]; dropped: number[] }
  | { refused: "MARKERS_CHANGED" } {
  const split: WordSelectionLine[] = [];
  const dropped: number[] = [];
  for (const [i, line] of lines.entries()) {
    const { kept, formats } = paragraphs[i] ?? {};
    const marked = splitWordMarkedLine(
      line,
      kept?.markers ?? [],
      formats?.spans.map((span) => span.number),
    );
    if ("refused" in marked) return marked;
    split.push({
      text: withoutFormatMarkers(line, formats?.spans),
      pieces: kept ? marked.pieces : null,
      parts: marked.parts,
    });
    dropped.push(...marked.dropped);
  }
  return { lines: split, dropped };
}

/** `text` without the markers of `spans`. */
export function withoutFormatMarkers(
  text: string,
  spans: readonly Pick<WordFormatSpan, "number">[] | undefined,
): string {
  if (!spans?.length) return text;
  const numbers = new Set(spans.map((span) => span.number));
  return text.replace(WORD_MARKER, (marker, _close: string, number: string) =>
    numbers.has(Number(number)) ? "" : marker,
  );
}
