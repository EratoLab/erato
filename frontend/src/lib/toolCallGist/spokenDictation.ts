/* eslint-disable lingui/no-unlocalized-strings -- words and punctuation the comparison recognises, not copy */
import { isInvisibleFormatChar } from "./serverText";

/**
 * Whether a long text on an approval card is what the user dictated in this
 * chat, and how it relates to it. Only words that came from transcription
 * count as dictated; typed words never do. The comparison is on words: case,
 * punctuation at a word's edges and spacing are ignored, everything else
 * (a word, a number, a sign, a name, their order) makes the text different.
 * The text is compared with the user's latest dictation it relates to, never
 * with one they corrected since. When the relation is unclear, the text is
 * not called dictated at all.
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
 * - `unchanged`: word for word the whole message the user dictated, at most
 *   without an instruction such as "schreib dem Kunden:".
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
/** Shorter words a later message shares with the card do not make it a possible correction. */
const MIN_TELLING_CHARS = 3;
/** The word-by-word comparison is quadratic: longer texts are not compared. */
const MAX_COMPARED_WORDS = 3_000;

const QUOTES =
  "\"'\u201e\u201c\u201d\u201a\u2018\u2019\u00ab\u00bb\u2039\u203a";
/**
 * Punctuation a transcript or a model sets differently, at a word's edges
 * only. Signs that change a value (plus, hyphen, minus sign, percent, euro,
 * a dash before a digit) are kept.
 */
const LEADING = new RegExp(
  `^(?:[.,;:!?\u2026${QUOTES}()[\\]{}/*_]|[\u2013\u2014](?!\\d))+`,
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
  for (const word of visible(text.normalize("NFC")).split(/\s+/)) {
    const key = word.replace(LEADING, "").replace(TRAILING, "").toLowerCase();
    if (key.length === 0) continue;
    keys.push(key);
    raw.push(word);
  }
  return { keys, raw };
};

/** A text as the comparison sees it: its words, lower case, without edge punctuation. */
export const dictationKey = (text: string): string =>
  wordsOf(text).keys.join(" ");

/** Words that open a request to the assistant before the verb ("Nein, schreib: …"). */
const OPENERS = new Set([
  "nein",
  "ja",
  "okay",
  "ok",
  "also",
  "bitte",
  "und",
  "dann",
  "jetzt",
  "no",
  "yes",
  "please",
  "and",
  "then",
  "now",
  "so",
]);

/**
 * Verbs that tell the assistant what to do with the text that follows. Words
 * that are also nouns ("Note:", "Antwort:") are left out: as a label they
 * may be part of the dictation.
 */
const INSTRUCTION_VERBS = new Set([
  "schreib",
  "schreibe",
  "schreiben",
  "notier",
  "notiere",
  "notieren",
  "sag",
  "sage",
  "sagen",
  "antworte",
  "antworten",
  "schick",
  "schicke",
  "schicken",
  "send",
  "sende",
  "senden",
  "nimm",
  "nehmt",
  "formulier",
  "formuliere",
  "setz",
  "setze",
  "trag",
  "trage",
  "leg",
  "lege",
  "erstell",
  "erstelle",
  "verfass",
  "verfasse",
  "ergänz",
  "ergänze",
  "füg",
  "füge",
  "write",
  "tell",
  "say",
  "put",
  "add",
  "create",
  "use",
  "make",
  "take",
]);

/**
 * How many words open the dictation as an instruction to the assistant: a
 * short clause ending in a colon, with no sentence before it, whose first
 * word (after "nein", "bitte" and the like) is a verb such as "schreib". A
 * clause that is not recognisably an instruction is part of the dictation.
 */
const instructionWords = (dictated: Words): number => {
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
  const first = dictated.keys
    .slice(0, end + 1)
    .findIndex((key) => !OPENERS.has(key));
  return first !== -1 &&
    first <= end &&
    INSTRUCTION_VERBS.has(dictated.keys[first])
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
): DictationRelation | undefined => {
  const dictated = wordsOf(passage);
  const instruction = instructionWords(dictated);
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
 * Whether a message may be about the card's text: it shares a word with it,
 * or holds a number. "Nein, 16. Mai" may correct a text with "15. Mai";
 * "Ja, genau so" does not.
 */
const touches = (card: ReadonlySet<string>, text: string): boolean =>
  wordsOf(text).keys.some(
    (key) =>
      /\d/.test(key) || (key.length >= MIN_TELLING_CHARS && card.has(key)),
  );

/**
 * How `text` relates to what the user dictated in `turns`, all their
 * messages before the card, the latest first. `undefined` when it is not
 * their dictated text, or that is not clear. The latest message the text
 * relates to decides; a later message that may be about the text, dictated
 * or typed, ends the search, so a dictation the user may have corrected
 * since is never called the card's text.
 */
export const dictationOf = (
  text: string,
  turns: readonly UserTurn[],
): DictationRelation | undefined => {
  const card = wordsOf(text).keys;
  if (card.length < MIN_DICTATED_WORDS) return undefined;
  const cardWords = new Set(card);
  for (const turn of turns) {
    let best: DictationRelation | undefined;
    for (const passage of turn.passages) {
      const relation = comparePassage(card, passage, turn.whole);
      if (relation && (!best || RANK[relation] > RANK[best])) best = relation;
    }
    if (best) return best;
    if (touches(cardWords, turn.text)) return undefined;
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
