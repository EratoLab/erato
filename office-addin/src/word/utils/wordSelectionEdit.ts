import { splitWordMarkedLine } from "./wordSelectionItems";

import type {
  WordSelectionReplaceCode,
  WordSelectionShape,
} from "./wordSelectionAnchor";
import type { WordKeptMarker } from "./wordSelectionItems";

/** Fence tags are case-sensitive and must match the renderer registration. */
export const WORD_REPLACE_FENCE = "erato-word-replace";

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

/**
 * Per covered paragraph, its line split at the markers of the items it keeps; null for a paragraph
 * without items, whose line must hold no marker bracket, since it would be written as text.
 */
export function wordSelectionLinePieces(
  paragraphs: readonly {
    kept?: { markers: readonly Pick<WordKeptMarker, "number" | "end">[] };
  }[],
  lines: readonly string[],
): { pieces: (string[] | null)[] } | { refused: "MARKERS_CHANGED" } {
  const pieces: (string[] | null)[] = [];
  for (const [i, line] of lines.entries()) {
    const kept = paragraphs[i]?.kept;
    const split = splitWordMarkedLine(line, kept?.markers ?? []);
    if ("refused" in split) return split;
    pieces.push(kept ? split.pieces : null);
  }
  return { pieces };
}
