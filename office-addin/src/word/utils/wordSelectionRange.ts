import type { WordSelectionSupport } from "./wordSelectionSupport";

/**
 * Builds the range a Replace writes inside a proven paragraph. Word for the web changes the document
 * when an expandTo range inside a paragraph is read or selected (preflight impact 1), so the range
 * is one of Word's own search hits there; desktop proves the hit's offset with a prefix range too,
 * and reaches parts search cannot take through snippet points. A hit is used only when its text,
 * its index among the matches and, on desktop, its prefix all agree with the capture: nothing is
 * ever matched loosely or moved to another occurrence.
 */

/** Left to right without overlap, as Word's search reports matches (PF5). */
export function searchStartsOf(haystack: string, needle: string): number[] {
  const found: number[] = [];
  if (needle === "") return found;
  for (
    let at = haystack.indexOf(needle);
    at !== -1;
    at = haystack.indexOf(needle, at + needle.length)
  )
    found.push(at);
  return found;
}

/** Word's search reads ^ as a special-character code and cannot match control characters. */
export function wordSearchable(text: string, maxCharacters: number): boolean {
  return (
    text !== "" &&
    text.length <= maxCharacters &&
    !/[\^\u0000-\u001F]/.test(text)
  );
}

export interface WordSelectionRangeTarget {
  paragraph: Word.Paragraph;
  /** paragraph.text, which the caller has proven unchanged; the offsets count in it. */
  rangeText: string;
  start: number;
  /** Exclusive. */
  end: number;
  /** The index among the search matches the capture recorded, where it recorded one. */
  occurrence?: number;
}

export type WordSelectionRangePart =
  | { kind: "whole"; paragraph: Word.Paragraph }
  | {
      kind: "part";
      paragraph: Word.Paragraph;
      range: Word.Range;
      /** rangeText.slice(start, end): what range.text must still read before a write. */
      part: string;
    };

export type WordSelectionRangeBuild =
  | { parts: WordSelectionRangePart[] }
  | { refused: "TARGET_RANGE_UNPROVEN" };

const FOLLOWS = new Set(["Before", "AdjacentBefore"]);
const SNIPPET_LENGTHS = [40, 16, 6, 2] as const;

/** Queued only; the caller's next sync runs it. */
export function queueWordSearch(
  paragraph: Word.Paragraph,
  text: string,
): Word.RangeCollection {
  const hits = paragraph.search(text, { matchCase: true });
  hits.load("items");
  return hits;
}

/**
 * The hit at the target's offset, once Word's hits line up with the paragraph text's matches: as
 * many, each with exactly the searched text, in document order. Word's Find also matches straight
 * and curly quote variants, which shows here as an extra hit or one with other text. On desktop
 * every hit's prefix text must equal the paragraph text before its match as well.
 */
export async function wordSearchHitAt(
  context: Word.RequestContext,
  hits: Word.RangeCollection,
  target: WordSelectionRangeTarget,
  prefixRanges: boolean,
): Promise<Word.Range | null> {
  const { paragraph, rangeText, start, end, occurrence } = target;
  const part = rangeText.slice(start, end);
  const starts = searchStartsOf(rangeText, part);
  const index = starts.indexOf(start);
  const items = hits.items;
  if (
    index < 0 ||
    (occurrence !== undefined && occurrence !== index) ||
    items.length !== starts.length ||
    items.some((hit) => hit.text !== part)
  )
    return null;
  const order = items
    .slice(1)
    .map((hit, i) => items[i].compareLocationWith(hit));
  const prefixes = prefixRanges
    ? items.map((hit) => {
        const prefix = paragraph
          .getRange("Start")
          .expandTo(hit.getRange("Start"));
        prefix.load("text");
        return prefix;
      })
    : [];
  if (order.length || prefixes.length) await context.sync();
  if (!order.every((relation) => FOLLOWS.has(relation.value))) return null;
  if (
    !prefixes.every(
      (prefix, i) => prefix.text === rangeText.slice(0, starts[i]),
    )
  )
    return null;
  return items[index];
}

/**
 * A collapsed range at an offset of a desktop paragraph, found by searching the text next to it
 * within the part and proven by the prefix text up to it (harness probe.ts pointAt).
 */
async function pointAt(
  context: Word.RequestContext,
  target: WordSelectionRangeTarget,
  side: "start" | "end",
  support: WordSelectionSupport,
): Promise<Word.Range | null> {
  const { paragraph, rangeText, start, end } = target;
  const offset = side === "start" ? start : end;
  if (offset === 0) return paragraph.getRange("Start");
  if (offset === rangeText.length)
    return paragraph.getRange("Content").getRange("End");
  const room = end - start;
  for (const max of SNIPPET_LENGTHS) {
    const length = Math.min(max, room);
    const snippet =
      side === "start"
        ? rangeText.slice(offset, offset + length)
        : rangeText.slice(offset - length, offset);
    if (
      !snippet.trim() ||
      !wordSearchable(snippet, support.searchMaxCharacters)
    )
      continue;
    const hits = queueWordSearch(paragraph, snippet);
    await context.sync();
    const points = hits.items.map((hit) =>
      hit.getRange(side === "start" ? "Start" : "End"),
    );
    const prefixes = points.map((point) => {
      const prefix = paragraph.getRange("Start").expandTo(point);
      prefix.load("text");
      return prefix;
    });
    if (prefixes.length) await context.sync();
    const wanted = rangeText.slice(0, offset);
    const proven = points.filter((_, i) => prefixes[i].text === wanted);
    if (proven.length === 1) return proven[0];
  }
  return null;
}

async function partRange(
  context: Word.RequestContext,
  target: WordSelectionRangeTarget,
  support: WordSelectionSupport,
): Promise<Word.Range | null> {
  const part = target.rangeText.slice(target.start, target.end);
  if (part === "") return null;
  if (wordSearchable(part, support.searchMaxCharacters)) {
    const hits = queueWordSearch(target.paragraph, part);
    await context.sync();
    return wordSearchHitAt(context, hits, target, support.prefixRanges);
  }
  if (!support.prefixRanges) return null;
  const from = await pointAt(context, target, "start", support);
  const to = from && (await pointAt(context, target, "end", support));
  if (!from || !to) return null;
  const range = from.expandTo(to);
  range.load("text");
  await context.sync();
  return range.text === part ? range : null;
}

/**
 * Per covered paragraph, the paragraph itself where it is covered whole, else the range of its
 * part. Never a range across paragraphs, and on the web never an expandTo range at all.
 */
export async function buildWordSelectionRanges(
  context: Word.RequestContext,
  targets: readonly WordSelectionRangeTarget[],
  support: WordSelectionSupport,
): Promise<WordSelectionRangeBuild> {
  const parts: WordSelectionRangePart[] = [];
  for (const target of targets) {
    const { paragraph, rangeText, start, end } = target;
    if (start === 0 && end === rangeText.length) {
      parts.push({ kind: "whole", paragraph });
      continue;
    }
    const range = await partRange(context, target, support);
    if (!range) return { refused: "TARGET_RANGE_UNPROVEN" };
    parts.push({
      kind: "part",
      paragraph,
      range,
      part: rangeText.slice(start, end),
    });
  }
  return { parts };
}
