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

/** Up to two match starts, as indices into the body padded with a null edge on each side. */
function occurrences(
  texts: readonly string[],
  needle: readonly (string | null)[],
): number[] {
  const padded = [null, ...texts, null];
  const found: number[] = [];
  for (let start = 0; start + needle.length <= padded.length; start += 1) {
    if (needle.every((text, k) => padded[start + k] === text)) {
      found.push(start);
      if (found.length === 2) break;
    }
  }
  return found;
}

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
  };
  for (let window = 0; window <= widest(anchor); window += 1) {
    if (occurrences(texts, pattern(anchor, window)).length === 1)
      return { ...anchor, window };
  }
  return anchor;
}

/** Undefined when an ID is missing on either side; the span is then located by its text. */
function byId(
  anchor: WordParagraphAnchor,
  live: readonly WordParagraphEntry[],
): WordParagraphResolution | undefined {
  if (anchor.paragraphs.some((p) => !p.id)) return undefined;
  const index = new Map<string, number>();
  live.forEach((p, i) => {
    if (p.id) index.set(p.id, i);
  });
  const positions = anchor.paragraphs.map((p) => index.get(p.id!) ?? -1);
  if (positions.some((position) => position < 0)) return undefined;
  return positions.every(
    (position, i) =>
      (i === 0 || position === positions[i - 1] + 1) &&
      live[position].text === anchor.paragraphs[i].text,
  )
    ? { positions }
    : { refused: "changed" };
}

/**
 * A surviving ID is decisive: if its paragraph changed, a copy of the old text elsewhere must not
 * take its place. Without one, the span with its capture-time context must occur exactly once now.
 * A second occurrence refuses rather than widening the context, because a copied block and the
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
