/** Paragraphs kept on either side of a span to tell repeated text apart without IDs. */
export const WORD_ANCHOR_CONTEXT = 3;

/** One body paragraph; `id` is null where Word provides none. */
export interface WordParagraphEntry {
  id: string | null;
  text: string;
}

/** Consecutive paragraphs as captured, with the text around them at that time. */
export interface WordParagraphAnchor {
  paragraphs: readonly WordParagraphEntry[];
  /** Nearest first; null marks the start or end of the body. */
  before: readonly (string | null)[];
  after: readonly (string | null)[];
  /** Context paragraphs per side that made the span unique at capture; null when none did. */
  window: number | null;
  /** How often each narrower window and each span paragraph's text occurred at capture. */
  counts: readonly { needle: readonly (string | null)[]; count: number }[];
  /** The ID of the paragraph right above the span; null at the body's start or without IDs. */
  aboveId: string | null;
}

export type WordParagraphRefusal = "changed" | "ambiguous";

export type WordParagraphResolution =
  | { positions: number[] }
  | { refused: WordParagraphRefusal };

function context(
  texts: readonly string[],
  from: number,
  step: 1 | -1,
): (string | null)[] {
  const out: (string | null)[] = [];
  for (let i = from; out.length < WORD_ANCHOR_CONTEXT; i += step) {
    if (i < 0 || i >= texts.length) {
      out.push(null);
      break;
    }
    out.push(texts[i]);
  }
  return out;
}

function pattern(anchor: WordParagraphAnchor, window: number) {
  return [
    ...anchor.before.slice(0, window).reverse(),
    ...anchor.paragraphs.map((p) => p.text),
    ...anchor.after.slice(0, window),
  ];
}

/** Match starts, up to `limit`, as indices into the body padded with a null edge on each side. */
function occurrences(
  texts: readonly string[],
  needle: readonly (string | null)[],
  limit = 2,
): number[] {
  const padded = [null, ...texts, null];
  const found: number[] = [];
  for (let start = 0; start + needle.length <= padded.length; start += 1) {
    if (needle.every((text, k) => padded[start + k] === text)) {
      found.push(start);
      if (found.length === limit) break;
    }
  }
  return found;
}

const countOf = (
  texts: readonly string[],
  needle: readonly (string | null)[],
) => occurrences(texts, needle, Infinity).length;

function widest(anchor: WordParagraphAnchor): number {
  return Math.max(anchor.before.length, anchor.after.length);
}

/** `first` and `last` are inclusive positions in `body`. */
export function wordParagraphAnchor(
  body: readonly WordParagraphEntry[],
  first: number,
  last: number,
): WordParagraphAnchor {
  const texts = body.map((p) => p.text);
  const anchor: WordParagraphAnchor = {
    paragraphs: body.slice(first, last + 1),
    before: context(texts, first - 1, -1),
    after: context(texts, last + 1, 1),
    window: null,
    counts: [],
    aboveId: body[first - 1]?.id ?? null,
  };
  const counted = (needles: (string | null)[][]) =>
    needles.map((needle) => ({ needle, count: countOf(texts, needle) }));
  const own = [...new Set(texts.slice(first, last + 1))].map((text) => [text]);
  for (let window = 0; window <= widest(anchor); window += 1) {
    if (occurrences(texts, pattern(anchor, window)).length !== 1) continue;
    return {
      ...anchor,
      window,
      counts: counted([
        ...own,
        ...Array.from({ length: window }, (_, w) => pattern(anchor, w)),
      ]),
    };
  }
  return { ...anchor, counts: counted(own) };
}

/** Undefined when an ID is missing on either side; the span is then located by its text. */
function byId(
  anchor: WordParagraphAnchor,
  live: readonly WordParagraphEntry[],
): WordParagraphResolution | undefined {
  if (anchor.paragraphs.some((p) => !p.id)) return undefined;
  const index = new Map<string, number>();
  const repeated = new Set<string>();
  live.forEach((p, i) => {
    if (!p.id) return;
    if (index.has(p.id)) repeated.add(p.id);
    index.set(p.id, i);
  });
  if (anchor.paragraphs.some((p) => repeated.has(p.id!)))
    return { refused: "ambiguous" };
  const positions = anchor.paragraphs.map((p) => index.get(p.id!) ?? -1);
  if (positions.some((position) => position < 0)) return undefined;
  const intact = positions.every(
    (position, i) =>
      (i === 0 || position === positions[i - 1] + 1) &&
      live[position].text === anchor.paragraphs[i].text,
  );
  if (!intact) return { refused: "changed" };
  // Word hands a paragraph's ID to the paragraph split off below it (Return at its end,
  // insertParagraph "After", office-js #5784), once per Return. So with the target's text anywhere
  // above, the ID may have moved onto a copy typed one or more paragraphs below the original. Then
  // the paragraph right above it is the original or one typed since, never the captured neighbour,
  // whose ID can only move onto a paragraph inserted between it and the original. Texts cannot tell
  // this apart under a run of identical twins.
  const first = positions[0];
  const text = anchor.paragraphs[0].text;
  const twinAbove = live.slice(0, first).some((p) => p.text === text);
  const moved = anchor.aboveId
    ? live[first - 1]?.id !== anchor.aboveId
    : !anchor.before.every(
        (expected, k) =>
          (first - 1 - k < 0 ? null : live[first - 1 - k].text) === expected,
      );
  if (twinAbove && moved) return { refused: "ambiguous" };
  return { positions };
}

function commoner(
  anchor: WordParagraphAnchor,
  live: readonly WordParagraphEntry[],
): boolean {
  const texts = live.map((p) => p.text);
  return anchor.counts.some(
    ({ needle, count }) => countOf(texts, needle) > count,
  );
}

/**
 * A surviving ID is decisive: if its paragraph changed, a copy of the old text elsewhere must not
 * take its place, nor where it may have moved onto a copy of its text: with that text above it, the
 * captured neighbour above must still be there. Without one, the span with its capture-time context
 * must occur exactly once now, and the texts it is built from no more often than at capture. A
 * second occurrence refuses rather than widening the context, because a copied block and the
 * original are indistinguishable by text.
 */
export function resolveWordParagraphs(
  anchor: WordParagraphAnchor,
  live: readonly WordParagraphEntry[],
): WordParagraphResolution {
  const identified = byId(anchor, live);
  if (identified) return identified;
  if (anchor.window === null) return { refused: "ambiguous" };
  const texts = live.map((p) => p.text);
  const found = occurrences(texts, pattern(anchor, anchor.window));
  // A copy made since capture can take over the captured context (a twin above the span plus a copy
  // inserted below it), so the one match proves nothing once the text it is built from is commoner.
  if (found.length === 1 && commoner(anchor, live))
    return { refused: "ambiguous" };
  if (found.length === 1) {
    const head = found[0] - 1 + Math.min(anchor.window, anchor.before.length);
    return { positions: anchor.paragraphs.map((_, i) => head + i) };
  }
  if (found.length > 1) return { refused: "ambiguous" };
  return {
    refused:
      anchor.window > 0 && occurrences(texts, pattern(anchor, 0)).length > 0
        ? "ambiguous"
        : "changed",
  };
}
