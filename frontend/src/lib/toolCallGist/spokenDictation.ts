/* eslint-disable lingui/no-unlocalized-strings -- words and punctuation the comparison recognises, not copy */
import { isInvisibleFormatChar } from "./serverText";
import { languagesHeard } from "./spokenLanguageData";

import type { SpokenCardLanguages } from "./spokenLanguageData";

/**
 * Whether a long text on an approval card is what the user dictated in this
 * chat, and how it relates to it. Only words that came from transcription
 * count as dictated; typed words never do. The comparison is on words: case,
 * punctuation at a word's edges and spacing are ignored, everything else
 * (a word, a number, a sign, a name, their order) makes the text different.
 * A word-for-word claim is made only against the user's latest message: if
 * anything was said or typed after the dictation, the user may want
 * something else now. When the relation is unclear, the text is not called
 * dictated at all.
 */

/** A message the user sent, and what of it they dictated. */
export interface UserTurn {
  text: string;
  /** The runs of the message that came from transcription unedited; none when typed. */
  passages: readonly string[];
  /** The one passage is the whole message: nothing in it was typed. */
  whole: boolean;
}

/**
 * How a card's text relates to the dictation.
 * - `unchanged`: word for word the whole message the user dictated last, at
 *   most without an instruction such as "schreib dem Kunden:".
 * - `part`: word for word a part of it; something dictated is not in it.
 * - `extended`: holds the dictated text word for word, and more, but mostly
 *   the dictation.
 * - `changed`: mostly the dictated words, but some differ, are missing or
 *   moved.
 */
export type DictationRelation = "unchanged" | "part" | "extended" | "changed";

/** Fewer matching words than this are no dictated text, but chance. */
const MIN_DICTATED_WORDS = 8;
/** An instruction such as "schreib dem Kunden:" is at most this long. */
const MAX_LEAD_IN_WORDS = 12;
/**
 * For `extended` and `changed`: most of the card's words are the user's.
 * For `changed`, the card also keeps at least half of what they dictated.
 */
const MIN_CARD_SHARE = 0.6;
const MIN_DICTATION_SHARE = 0.5;
/** The word-by-word comparison is quadratic: longer texts are not compared. */
const MAX_COMPARED_WORDS = 3_000;

const QUOTES =
  "\"'\u201e\u201c\u201d\u201a\u2018\u2019\u00ab\u00bb\u2039\u203a";
/**
 * Punctuation a transcript or a model sets differently, at a word's edges
 * only. Signs that change a value (plus, hyphen, minus sign, percent, euro,
 * a dash or slash before a digit) are kept.
 */
const LEADING = new RegExp(
  `^(?:[.,;:!?\u2026${QUOTES}()[\\]{}*_]|[\u2013\u2014/](?!\\d))+`,
  "u",
);
const TRAILING = new RegExp(
  `[.,;:!?\u2026${QUOTES}()[\\]{}/*_\u2013\u2014]+$`,
  "u",
);

const visible = (text: string): string =>
  Array.from(text)
    .filter((char) => !isInvisibleFormatChar(char.codePointAt(0) ?? 0))
    .join("");

interface Words {
  /** Each word as compared. */
  keys: string[];
  /** Each word as written, for telling an instruction. */
  raw: string[];
}

// NFC, not NFKC: compatibility forms such as a superscript two carry a value.
const wordsOf = (text: string): Words => {
  const keys: string[] = [];
  const raw: string[] = [];
  const words = visible(text.normalize("NFC")).split(/\s+/);
  words.forEach((word, index) => {
    // A dash standing alone before a number is its sign: "– 5 Grad".
    const sign =
      /^[\u2013\u2014]+$/.test(word) && /^\d/.test(words[index + 1] ?? "");
    const key = sign
      ? word
      : word.replace(LEADING, "").replace(TRAILING, "").toLowerCase();
    if (key.length === 0) return;
    keys.push(key);
    raw.push(word);
  });
  return { keys, raw };
};

/** A text as the comparison sees it: its words, lower case, without edge punctuation. */
export const dictationKey = (text: string): string =>
  wordsOf(text).keys.join(" ");

/**
 * The words an instruction to the assistant before the dictated text may be
 * made of, per language: verbs that say what to do with the text, and the
 * few words around them ("Nein, schreib dem Kunden eine Mail:"). A clause
 * with any other word (a name, a negation, a verb that may be meant for the
 * recipient) is part of the dictation. The words are language data
 * (`dictation_verbs`, `dictation_words`).
 */
interface InstructionSet {
  verbs: ReadonlySet<string>;
  all: ReadonlySet<string>;
}

const instructionSets = (
  language: string | undefined,
  languages: SpokenCardLanguages | undefined,
): InstructionSet[] =>
  languagesHeard(language, languages)
    .filter((words) => words.dictation_verbs.length > 0)
    .map(({ dictation_verbs: verbs, dictation_words: others }) => ({
      verbs: new Set(verbs),
      all: new Set([...verbs, ...others]),
    }));

/**
 * How many words open the dictation as an instruction to the assistant: a
 * clause ending in a colon, with no sentence before it, every word of which
 * is an instruction word of one language, one of them a verb. Anything else
 * before a colon is part of the dictation.
 */
const instructionWords = (
  dictated: Words,
  sets: readonly InstructionSet[],
): number => {
  const end = dictated.raw
    .slice(0, MAX_LEAD_IN_WORDS)
    .findIndex((word) => /:["'\u201c\u201d\u00bb]?$/.test(word));
  if (end === -1) return 0;
  const clause = dictated.raw.slice(0, end + 1);
  if (
    clause
      .slice(0, -1)
      .some((word) => /[.!?:;]["'\u201c\u201d\u00bb)]?$/.test(word))
  ) {
    return 0;
  }
  const keys = dictated.keys.slice(0, end + 1);
  return sets.some(
    ({ verbs, all }) =>
      keys.every((key) => all.has(key)) && keys.some((key) => verbs.has(key)),
  )
    ? end + 1
    : 0;
};

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

const RANK: Record<DictationRelation, number> = {
  unchanged: 3,
  part: 2,
  extended: 1,
  changed: 0,
};

const comparePassage = (
  card: readonly string[],
  passage: string,
  whole: boolean,
  sets: readonly InstructionSet[],
): DictationRelation | undefined => {
  const dictated = wordsOf(passage);
  const instruction = instructionWords(dictated, sets);
  const content = dictated.keys.slice(instruction);
  const at = indexOfRun(dictated.keys, card);
  if (at !== -1) {
    const trailing = dictated.keys.length - at - card.length;
    // Anything typed in the message makes the dictation only a part of it.
    return whole && trailing === 0 && at === instruction ? "unchanged" : "part";
  }
  if (content.length < MIN_DICTATED_WORDS) return undefined;
  if (
    indexOfRun(card, content) !== -1 &&
    content.length >= MIN_CARD_SHARE * card.length
  ) {
    return "extended";
  }
  if (Math.max(card.length, content.length) > MAX_COMPARED_WORDS) {
    return undefined;
  }
  const common = commonWords(card, content);
  return common >= MIN_DICTATED_WORDS &&
    common >= MIN_CARD_SHARE * card.length &&
    common >= MIN_DICTATION_SHARE * content.length
    ? "changed"
    : undefined;
};

/**
 * How `text` relates to what the user dictated in `turns`, all their
 * messages before the card, the latest first. `undefined` when it is not
 * their dictated text, or that is not clear. The latest message the text
 * relates to decides. A word-for-word relation counts only when that is the
 * user's latest message: after anything said or typed since, they may want
 * something else, so the text is named by its size instead. A text changed
 * from an earlier dictation is still "changed": that claims no sameness.
 * An instruction before the dictation is read in German, English and the
 * card's `language`; without one, in every language of `languages` (the
 * built-in ones when not given).
 */
export const dictationOf = (
  text: string,
  turns: readonly UserTurn[],
  language?: string,
  languages?: SpokenCardLanguages,
): DictationRelation | undefined => {
  const card = wordsOf(text).keys;
  if (card.length < MIN_DICTATED_WORDS) return undefined;
  const sets = instructionSets(language, languages);
  for (const [index, turn] of turns.entries()) {
    let best: DictationRelation | undefined;
    for (const passage of turn.passages) {
      const relation = comparePassage(card, passage, turn.whole, sets);
      if (relation && (!best || RANK[relation] > RANK[best])) best = relation;
    }
    if (best) return index === 0 || best === "changed" ? best : undefined;
  }
  return undefined;
};

const isSpace = (char: string | undefined): boolean =>
  char === undefined || /\s/.test(char);

/** Where `heard` stands in `sent` as whole words, from `from` on. */
const wordsAt = (sent: string, heard: string, from: number): number => {
  for (
    let at = sent.indexOf(heard, from);
    at !== -1;
    at = sent.indexOf(heard, at + 1)
  ) {
    if (isSpace(sent[at - 1]) && isSpace(sent[at + heard.length])) return at;
  }
  return -1;
};

/**
 * The runs of a sent message that came from transcription unedited: each
 * transcript that is still in the message as it was heard, as whole words,
 * joined with the ones next to it.
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
    let at = wordsAt(sent, heard, from);
    if (at === -1) at = wordsAt(sent, heard, 0);
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

/** A sent message with the words of it that were dictated, if any. */
export const userTurnOf = (
  sent: string,
  transcripts: readonly string[],
): UserTurn => {
  const text = sent.trim();
  const passages = dictatedPassages(text, transcripts);
  return {
    text,
    passages,
    whole: passages.length === 1 && passages[0] === text,
  };
};
