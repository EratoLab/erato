/**
 * Numbers a person said in words, read through a per-language table the
 * deployment supplies (`[spoken_number_words.<language>]`). The table holds
 * the words: which are numbers, which multiply, which join, which are
 * ordinals and how those end, and which may be something else. This module
 * combines them by one structure, the one German and English share: units
 * before the tens with a joiner ("zweiundzwanzig") or after them
 * ("twenty-two"), then hundreds, then thousands and up, written as one word
 * or several. A language built otherwise (French "quatre-vingt-dix", 4 × 20
 * + 10) needs this structure extended before its data can work. Without a
 * table no word is read as a number; digits always are.
 */

/** One language's number words, as the backend passes them on. */
export interface NumberWords {
  /** Words that are a number alone and inside a compound. */
  numbers?: Record<string, number>;
  /**
   * Words that may be a number or another word ("ein", "one", "second"):
   * inside a compound they are a number, alone only maybe.
   */
  ambiguous?: Record<string, number>;
  /** Words that multiply what comes before them: hundred, thousand. */
  multipliers?: Record<string, number>;
  /** Words that join the parts of one number: "und", "and". */
  joiners?: string[];
  /** Ordinals, as the stem before an ending: "zwanzigst", "third". */
  ordinals?: Record<string, number>;
  /**
   * Ordinal stems that may be another word ("acht" in "achte darauf",
   * "erst" in "als Erstes"): inside a compound an ordinal, alone only maybe.
   */
  ambiguous_ordinals?: Record<string, number>;
  /** What may follow an ordinal stem; `""` lets it stand alone. */
  ordinal_endings?: string[];
}

/** The numbers in a person's words: read for sure, and read only maybe. */
export interface NumbersSaid {
  sure: ReadonlySet<number>;
  maybe: ReadonlySet<number>;
}

type Kind = "number" | "multiplier" | "joiner" | "ordinal";

interface Part {
  kind: Kind;
  value: number;
  /** Alone it may be another word. */
  ambiguous: boolean;
}

/** Longer words are no number words; it also bounds splitting a compound. */
const MAX_WORD_CHARS = 64;

interface Lexicon {
  parts: Map<string, Part[]>;
  endings: string[];
  /** Longest entry first, for splitting a compound. */
  keys: string[];
}

const fold = (word: string) => word.toLowerCase().normalize("NFKC").trim();

const usable = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const lexiconOf = (table: NumberWords): Lexicon => {
  const parts = new Map<string, Part[]>();
  const put = (
    kind: Kind,
    entries: Record<string, number> | undefined,
    ambiguous = false,
  ) => {
    for (const [word, value] of Object.entries(entries ?? {}))
      if (usable(value) && fold(word).length > 0)
        parts.set(fold(word), [
          ...(parts.get(fold(word)) ?? []),
          { kind, value, ambiguous },
        ]);
  };
  put("number", table.numbers);
  put("number", table.ambiguous, true);
  put("multiplier", table.multipliers);
  put("ordinal", table.ordinals);
  put("ordinal", table.ambiguous_ordinals, true);
  for (const word of table.joiners ?? [])
    if (fold(word).length > 0)
      parts.set(fold(word), [{ kind: "joiner", value: 0, ambiguous: false }]);
  const endings = [...new Set((table.ordinal_endings ?? []).map(fold))].sort(
    (a, b) => b.length - a.length,
  );
  const keys = [...parts.keys()].sort((a, b) => b.length - a.length);
  return { parts, endings, keys };
};

/**
 * Adds parts to one number, part by part, as long as they make one: the
 * units after the tens ("twenty two") or before them with a joiner
 * ("zwei und zwanzig"), a hundred, then a thousand or more.
 */
class Builder {
  total = 0;
  hundreds = 0;
  small = 0;
  /** The small part is a tens value still open for a unit. */
  tensOpen = false;
  /** The small part is a unit still open for a joiner and tens. */
  unitOpen = false;
  joined = false;
  lastBig = Number.POSITIVE_INFINITY;
  count = 0;
  ambiguousOnly = true;

  /** Whether `part` continues this number; it is added if it does. */
  add(part: Part): boolean {
    if (part.kind === "joiner") {
      if (this.count === 0 || this.joined) return false;
      this.joined = true;
      return true;
    }
    const { value } = part;
    const multiplies =
      part.kind === "multiplier" ||
      (part.kind === "ordinal" && value >= 100 && /^10*$/.test(String(value)));
    if (multiplies) {
      if (value < 1000) {
        if (this.hundreds !== 0 || (this.joined && this.small === 0))
          return false;
        this.hundreds = (this.small || 1) * value;
        this.small = 0;
      } else {
        if (value >= this.lastBig) return false;
        this.total += (this.hundreds + this.small || 1) * value;
        this.hundreds = 0;
        this.small = 0;
        this.lastBig = value;
      }
      this.tensOpen = false;
      this.unitOpen = false;
    } else if (value >= 100) {
      return false;
    } else if (this.small === 0) {
      if (
        this.joined &&
        this.count > 0 &&
        this.hundreds === 0 &&
        this.total === 0
      )
        return false;
      this.small = value;
      this.tensOpen = value >= 20 && value % 10 === 0;
      this.unitOpen = value > 0 && value < 10;
    } else if (this.tensOpen && !this.joined && value > 0 && value < 10) {
      this.small += value;
      this.tensOpen = false;
      this.unitOpen = false;
    } else if (
      this.unitOpen &&
      this.joined &&
      value >= 20 &&
      value % 10 === 0
    ) {
      this.small += value;
      this.tensOpen = false;
      this.unitOpen = false;
    } else {
      return false;
    }
    this.joined = false;
    this.count++;
    if (!part.ambiguous) this.ambiguousOnly = false;
    return true;
  }

  /** The number so far, or `undefined` when there is none or it ends open. */
  value(): number | undefined {
    return this.joined ? undefined : this.settled();
  }

  /** The number so far, leaving out a joiner it ends with. */
  settled(): number | undefined {
    return this.count === 0
      ? undefined
      : this.total + this.hundreds + this.small;
  }
}

/** The parts one word splits into that make one number, the longest entries first. */
const split = (
  stem: string,
  lexicon: Lexicon,
  ordinalLast: boolean,
): Part[] | undefined => {
  function* splits(at: number): Generator<Part[]> {
    if (at === stem.length) {
      yield [];
      return;
    }
    for (const key of lexicon.keys) {
      if (!stem.startsWith(key, at)) continue;
      const end = at + key.length === stem.length;
      for (const part of lexicon.parts.get(key) ?? []) {
        if ((part.kind === "ordinal") !== (ordinalLast && end)) continue;
        for (const rest of splits(at + key.length)) yield [part, ...rest];
      }
    }
  }
  for (const parts of splits(0)) {
    const builder = new Builder();
    if (
      parts.every((part) => builder.add(part)) &&
      builder.value() !== undefined
    )
      return parts;
  }
  return undefined;
};

/** A word as the number parts it is made of, or `undefined` for any other word. */
const partsOf = (word: string, lexicon: Lexicon): Part[] | undefined => {
  if (Array.from(word).length > MAX_WORD_CHARS) return undefined;
  const joiner = lexicon.parts
    .get(word)
    ?.find((part) => part.kind === "joiner");
  if (joiner) return [joiner];
  const cardinal = split(word, lexicon, false);
  if (cardinal) return cardinal;
  for (const ending of lexicon.endings) {
    if (!word.endsWith(ending) || word.length === ending.length) continue;
    const ordinal = split(
      word.slice(0, word.length - ending.length),
      lexicon,
      true,
    );
    if (ordinal) return ordinal;
  }
  return undefined;
};

const DIGITS = /^(\d+)(\p{L}*)$/u;

/**
 * `table` when it holds what reading needs: numbers, ordinals and their
 * endings. A table that lacks any of them would read a day said in words as
 * not said, so it counts as no table.
 */
export const readableNumberWords = (
  table: NumberWords | undefined,
): NumberWords | undefined => {
  const some = (entries: Record<string, number> | undefined) =>
    Object.keys(entries ?? {}).length > 0;
  return table &&
    some(table.numbers) &&
    (some(table.ordinals) || some(table.ambiguous_ordinals)) &&
    (table.ordinal_endings?.length ?? 0) > 0
    ? table
    : undefined;
};

/**
 * The numbers in `tokens` (lower case, split at anything but letters and
 * digits). Digits are read in any language, also with letters after them
 * ("22nd"). Words are read through `table`: parts next to each other make
 * one number as far as they can; where they cannot, each number they make
 * is only maybe meant ("twenty twenty-six" is a year, not the 20th and the
 * 26th), and so is an ambiguous word on its own.
 */
export const numbersSaid = (
  tokens: readonly string[],
  table: NumberWords | undefined,
): NumbersSaid => {
  const sure = new Set<number>();
  const maybe = new Set<number>();
  const readable = readableNumberWords(table);
  const lexicon = readable ? lexiconOf(readable) : undefined;

  let run: { builder: Builder; split: boolean; values: number[] } | null = null;
  const close = () => {
    if (!run) return;
    const value = run.builder.settled();
    const values = value === undefined ? run.values : [...run.values, value];
    const unsure =
      run.split || (values.length === 1 && run.builder.ambiguousOnly);
    for (const each of values) (unsure ? maybe : sure).add(each);
    run = null;
  };
  const addParts = (parts: readonly Part[]) => {
    for (const part of parts) {
      run ??= { builder: new Builder(), split: false, values: [] };
      if (run.builder.add(part)) continue;
      if (part.kind === "joiner" || run.builder.joined) {
        // Joined parts that make no one number ("zwei und drei", French
        // "vingt et un") are only maybe the numbers they make.
        run.split = true;
        close();
        if (part.kind !== "joiner") {
          addParts([part]);
          run.split = true;
        }
        continue;
      }
      const value = run.builder.settled();
      const values = value === undefined ? run.values : [...run.values, value];
      run = { builder: new Builder(), split: values.length > 0, values };
      run.builder.add(part);
    }
  };

  let digitsBefore: number | null = null;
  for (const token of tokens) {
    const digits = DIGITS.exec(token);
    if (digits) {
      close();
      const value = Number(digits[1]);
      if (Number.isSafeInteger(value)) sure.add(value);
      digitsBefore = Number.isSafeInteger(value) ? value : null;
      continue;
    }
    const parts = lexicon ? partsOf(token, lexicon) : undefined;
    // Digits with a multiplier word after them: "341 Tausend".
    if (
      digitsBefore !== null &&
      parts?.length === 1 &&
      parts[0].kind === "multiplier"
    ) {
      const value = digitsBefore * parts[0].value;
      if (Number.isSafeInteger(value)) sure.add(value);
      digitsBefore = null;
      continue;
    }
    digitsBefore = null;
    if (!parts) {
      close();
      continue;
    }
    addParts(parts);
  }
  close();
  for (const value of sure) maybe.delete(value);
  return { sure, maybe };
};
