import { describe, expect, it } from "vitest";

import words from "./fixtures/spokenNumberWords.json";
import { numbersSaid } from "./spokenNumbers";

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
    ["de", "am ersten", [1]],
    ["de", "der dritte", [3]],
    ["de", "den achten", [8]],
    ["de", "acht Prozent", [8]],
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
    ["de", "zwei und drei", [2, 3]],
    ["en", "make it the twenty-second", [22]],
    ["en", "January twentieth", [20]],
    ["en", "the first", [1]],
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
