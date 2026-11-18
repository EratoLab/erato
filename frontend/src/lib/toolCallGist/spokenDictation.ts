/**
 * Whether a long text on an approval card is what the user dictated in this
 * chat, and how it relates to it. Only words that came from transcription
 * count as dictated; typed words never do. The comparison is on words: case,
 * punctuation at a word's edges and spacing are ignored, everything else
 * (a word, a number, a name, their order) makes the text different. When
 * the relation is unclear, the text is not called dictated at all.
 */

/** What the user dictated in one turn: the runs of it that came from transcription unedited. */
export interface DictatedTurn {
  passages: readonly string[];
}

/**
 * How a card's text relates to the dictation.
 * - `unchanged`: word for word the dictated text, at most without a lead-in
 *   such as "schreib dem Kunden:".
 * - `part`: word for word a part of it; something dictated is not in it.
 * - `extended`: holds the dictated text word for word, and more.
 * - `changed`: mostly the dictated words, but some differ, are missing or
 *   moved.
 */
export type DictationRelation = "unchanged" | "part" | "extended" | "changed";

/** Fewer matching words than this are no dictated text, but chance. */
const MIN_DICTATED_WORDS = 8;
/** A lead-in such as "schreib dem Kunden:" is at most this long. */
const MAX_LEAD_IN_WORDS = 12;
/**
 * For `changed`: most of the card's words are the user's, and the card keeps
 * at least half of what they dictated.
 */
const MIN_CARD_SHARE = 0.6;
const MIN_DICTATION_SHARE = 0.5;
/** The word-by-word comparison is quadratic: longer texts are not compared. */
const MAX_COMPARED_WORDS = 3_000;

const INVISIBLE = /[\u00ad\u200b-\u200d\u2060\ufeff]/g;
/**
 * Punctuation a transcript or a model sets differently, at a word's edges
 * only. Signs that change a value (+, −, %, €, a hyphen before a number)
 * are kept.
 */
const EDGE_PUNCTUATION =
  /^[.,;:!?\u2026"'\u201e\u201c\u201d\u201a\u2018\u2019\u00ab\u00bb\u2039\u203a()[\]{}\u2013\u2014/*_]+|[.,;:!?\u2026"'\u201e\u201c\u201d\u201a\u2018\u2019\u00ab\u00bb\u2039\u203a()[\]{}\u2013\u2014/*_]+$/gu;

interface Words {
  /** Each word as compared. */
  keys: string[];
  /** Each word as written, for telling a lead-in. */
  raw: string[];
}

const wordsOf = (text: string): Words => {
  const keys: string[] = [];
  const raw: string[] = [];
  for (const word of text
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .split(/\s+/)) {
    const key = word.replace(EDGE_PUNCTUATION, "").toLowerCase();
    if (key.length === 0) continue;
    keys.push(key);
    raw.push(word);
  }
  return { keys, raw };
};

/** A text as the comparison sees it: its words, lower case, without edge punctuation. */
export const dictationKey = (text: string): string =>
  wordsOf(text).keys.join(" ");

const indexOfRun = (
  whole: readonly string[],
  run: readonly string[],
): number => {
  if (run.length === 0 || run.length > whole.length) return -1;
  outer: for (let start = 0; start + run.length <= whole.length; start++) {
    for (let index = 0; index < run.length; index++) {
      if (whole[start + index] !== run[index]) continue outer;
    }
    return start;
  }
  return -1;
};

/**
 * Words before the text that only say what to do with it: a short clause
 * ending in a colon, with no sentence of its own before it.
 */
const isLeadIn = (raw: readonly string[]): boolean =>
  raw.length <= MAX_LEAD_IN_WORDS &&
  /:["'„“”»]?$/.test(raw.at(-1) ?? "") &&
  raw.slice(0, -1).every((word) => !/[.!?:;]["'„“”»)]?$/.test(word));

/** The dictated words without a lead-in. */
const contentOf = (dictated: Words): string[] => {
  for (
    let end = 1;
    end <= Math.min(MAX_LEAD_IN_WORDS, dictated.raw.length);
    end++
  ) {
    if (/:["'„“”»]?$/.test(dictated.raw[end - 1])) {
      return isLeadIn(dictated.raw.slice(0, end))
        ? dictated.keys.slice(end)
        : dictated.keys;
    }
  }
  return dictated.keys;
};

const commonWords = (a: readonly string[], b: readonly string[]): number => {
  let previous = new Array<number>(b.length + 1).fill(0);
  for (const word of a) {
    const row = new Array<number>(b.length + 1).fill(0);
    for (let index = 0; index < b.length; index++) {
      row[index + 1] =
        word === b[index]
          ? previous[index] + 1
          : Math.max(previous[index + 1], row[index]);
    }
    previous = row;
  }
  return previous[b.length];
};

interface Found {
  relation: DictationRelation;
  /** For ranking two `changed` finds. */
  share: number;
}

const relationTo = (
  card: readonly string[],
  dictated: Words,
): Found | undefined => {
  const at = indexOfRun(dictated.keys, card);
  if (at !== -1) {
    const trailing = dictated.keys.length - at - card.length;
    const leading = dictated.raw.slice(0, at);
    return {
      relation:
        trailing === 0 && (at === 0 || isLeadIn(leading))
          ? "unchanged"
          : "part",
      share: 1,
    };
  }
  const content = contentOf(dictated);
  if (content.length < MIN_DICTATED_WORDS) return undefined;
  if (indexOfRun(card, content) !== -1) {
    return { relation: "extended", share: content.length / card.length };
  }
  if (Math.max(card.length, content.length) > MAX_COMPARED_WORDS)
    return undefined;
  const common = commonWords(card, content);
  return common >= MIN_DICTATED_WORDS &&
    common >= MIN_CARD_SHARE * card.length &&
    common >= MIN_DICTATION_SHARE * content.length
    ? {
        relation: "changed",
        share: common / Math.max(card.length, content.length),
      }
    : undefined;
};

const RANK: Record<DictationRelation, number> = {
  unchanged: 3,
  part: 2,
  extended: 1,
  changed: 0,
};

/**
 * How `text` relates to what the user dictated in `turns`, or `undefined`
 * when it is not their dictated text, or that is not clear.
 */
export const dictationOf = (
  text: string,
  turns: readonly DictatedTurn[],
): DictationRelation | undefined => {
  const card = wordsOf(text).keys;
  if (card.length < MIN_DICTATED_WORDS) return undefined;
  let best: Found | undefined;
  for (const turn of turns) {
    for (const passage of turn.passages) {
      const found = relationTo(card, wordsOf(passage));
      if (
        found &&
        (!best ||
          RANK[found.relation] > RANK[best.relation] ||
          (found.relation === best.relation && found.share > best.share))
      ) {
        best = found;
      }
    }
  }
  return best?.relation;
};

/**
 * The runs of a sent message that came from transcription unedited: each
 * transcript that is still in the message as it was heard, joined with the
 * ones next to it.
 */
export const dictatedPassages = (
  sent: string,
  transcripts: readonly string[],
): string[] => {
  const covered = new Array<boolean>(sent.length).fill(false);
  let from = 0;
  for (const transcript of transcripts) {
    const heard = transcript.trim();
    if (heard.length === 0) continue;
    let at = sent.indexOf(heard, from);
    if (at === -1) at = sent.indexOf(heard);
    if (at === -1) continue;
    covered.fill(true, at, at + heard.length);
    from = at + heard.length;
  }
  const passages: string[] = [];
  let start = -1;
  for (let index = 0; index <= sent.length; index++) {
    const inside =
      index < sent.length &&
      (covered[index] || (start !== -1 && /\s/.test(sent[index])));
    if (inside && start === -1) start = index;
    if (!inside && start !== -1) {
      const passage = sent.slice(start, index).trim();
      if (passage.length > 0) passages.push(passage);
      start = -1;
    }
  }
  return passages;
};
