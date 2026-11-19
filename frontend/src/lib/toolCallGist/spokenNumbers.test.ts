import { describe, expect, it } from "vitest";

import words from "./fixtures/spokenNumberWords.json";
import { numbersSaid, readableNumberWords } from "./spokenNumbers";

import type { NumberWords } from "./spokenNumbers";

const TEST_NUMBER_WORDS = words as unknown as Record<"de" | "en", NumberWords>;

const tokens = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFKC")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0);

const read = (text: string, language: "de" | "en" | "none") => {
  const said = numbersSaid(
    tokens(text),
    language === "none" ? undefined : TEST_NUMBER_WORDS[language],
  );
  return { sure: [...said.sure].sort((a, b) => a - b), maybe: [...said.maybe] };
};

describe("numbers said in words, read through a test table", () => {
  it.each([
    ["de", "Nimm den zweiundzwanzigsten", [22]],
    ["de", "Nicht auf den Fünfzehnten, nimm den Zweiundzwanzigsten.", [15, 22]],
    ["de", "einunddreißigsten", [31]],
    ["de", "den vierten", [4]],
    ["de", "achtundzwanzigsten", [28]],
    ["de", "einunddreißigsten", [31]],
    ["de", "zweiundzwanzig", [22]],
    ["de", "zwei und zwanzig", [22]],
    ["de", "sechzig Prozent", [60]],
    ["de", "dreihunderteinundvierzigtausend Euro", [341_000]],
    ["de", "zweihundertfünfzig", [250]],
    ["de", "eintausendzweihundert", [1200]],
    ["de", "eine Million", [1_000_000]],
    ["de", "341 Tausend", [341, 341_000]],
    ["de", "den 22.", [22]],
    ["de", "den 22sten", [22]],
    ["en", "make it the twenty-second", [22]],
    ["en", "January twentieth", [20]],
    ["en", "twenty-third", [23]],
    ["en", "sixty percent", [60]],
    ["en", "three hundred and five", [305]],
    ["en", "three hundred forty-one thousand", [341_000]],
    ["en", "twenty two", [22]],
    ["en", "the 22nd", [22]],
  ] as const)("%s: %s", (language, text, sure) => {
    expect(read(text, language).sure).toEqual(sure);
  });

  it("an ambiguous word alone is only maybe a number, inside a compound it is one", () => {
    expect(read("nimm einen anderen", "de")).toEqual({ sure: [], maybe: [1] });
    expect(read("take the other one", "en")).toEqual({ sure: [], maybe: [1] });
    expect(read("einundzwanzig", "de").sure).toEqual([21]);
    expect(read("twenty one", "en").sure).toEqual([21]);
  });

  it.each([
    ["de", "Achte bitte darauf, dass alles stimmt.", 8],
    ["de", "Bitte achten Sie darauf.", 8],
    ["de", "Gib acht.", 8],
    ["de", "Als Erstes: der Termin.", 1],
    ["de", "zum ersten Mal", 1],
    ["de", "Nimm die zweite Variante.", 2],
    ["de", "der dritte Punkt", 3],
    ["de", "Noch eins: …", 1],
    ["de", "am achten", 8],
    ["de", "acht Prozent", 8],
    ["en", "Take a third of that.", 3],
    ["en", "first of all", 1],
  ] as const)(
    "%s: an everyday word the table marks ambiguous is only maybe a number: %s",
    (language, text, number) => {
      expect(read(text, language)).toEqual({ sure: [], maybe: [number] });
    },
  );

  it("joined parts that make no one number are only maybe meant", () => {
    expect(read("zwei und drei", "de")).toEqual({ sure: [], maybe: [2, 3] });
  });

  it("a very long word is no number, and reading it stays quick", () => {
    const started = Date.now();
    expect(read("dreizehn".repeat(30), "de")).toEqual({ sure: [], maybe: [] });
    expect(read("dreizehn".repeat(7), "de").maybe).toEqual([]);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("a table without numbers, ordinals or their endings counts as none", () => {
    for (const missing of ["numbers", "ordinals", "ordinal_endings"] as const) {
      const { [missing]: _, ...rest } = TEST_NUMBER_WORDS.de;
      const table =
        missing === "ordinals" ? { ...rest, ambiguous_ordinals: {} } : rest;
      expect(readableNumberWords(table), missing).toBeUndefined();
      expect(
        [...numbersSaid(tokens("zweiundzwanzigsten"), table).sure],
        missing,
      ).toEqual([]);
    }
    expect(readableNumberWords({})).toBeUndefined();
    expect(readableNumberWords(TEST_NUMBER_WORDS.de)).toBe(
      TEST_NUMBER_WORDS.de,
    );
  });

  it("numbers next to each other that make no one number are only maybe meant", () => {
    expect(read("twenty twenty-six", "en")).toEqual({
      sure: [],
      maybe: [20, 26],
    });
  });

  it("an ordinal stem without its ending is no number where the language needs one", () => {
    expect(read("erst morgen", "de")).toEqual({ sure: [], maybe: [] });
  });

  it("without a table only digits are read", () => {
    expect(read("nimm den zweiundzwanzigsten", "none")).toEqual({
      sure: [],
      maybe: [],
    });
    expect(read("nimm den 22.", "none").sure).toEqual([22]);
  });

  it("a wrongly shaped entry is left out, the rest of the table works", () => {
    const table = {
      ...TEST_NUMBER_WORDS.de,
      numbers: {
        ...TEST_NUMBER_WORDS.de.numbers,
        kaputt: -1,
        halb: 0.5,
      },
    };
    expect(
      [...numbersSaid(tokens("kaputt halb zwanzig"), table).sure].sort(),
    ).toEqual([20]);
  });
});
