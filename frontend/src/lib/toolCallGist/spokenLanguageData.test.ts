import { afterEach, describe, expect, it } from "vitest";

import languageBase from "@/lib/generated/languageBase.json";

import { spokenWordsFor } from "./spokenCardWords";
import { dictationOf } from "./spokenDictation";
import { languagesHeard, spokenCardLanguages } from "./spokenLanguageData";
import { earValue } from "./spokenValues";

import type { SpokenFacts } from "./spokenCard";
import type { SpokenCardLanguages } from "./spokenLanguageData";

const NOW = new Date("2026-11-17T09:00:00Z");

const FRENCH = {
  locale: "fr-FR",
  full_card: true,
  numbers: [
    "zéro",
    "un",
    "deux",
    "trois",
    "quatre",
    "cinq",
    "six",
    "sept",
    "huit",
    "neuf",
    "dix",
    "onze",
    "douze",
  ],
  ordinals: ["premier", "deuxième", "troisième"],
  time_full_hour: "{hour} heures",
  time: "{hour} h {minute}",
  dictation_verbs: ["écris"],
  dictation_words: ["au", "client"],
  difference_fillers: ["et"],
};

const inject = (languages: SpokenCardLanguages | undefined) => {
  window.APPROVAL_SPEECH_WORDS = languages;
};

afterEach(() => inject(undefined));

const dateDetail = (language: string, written: string) =>
  spokenWordsFor(language, { now: NOW, timeZone: "UTC" }).detail(
    { type: "set", field: "Date", value: earValue(written), loss: false },
    { action: "create" } as SpokenFacts,
  );

describe("language data for spoken cards", () => {
  it("without an injected environment, the generated built-in words apply", () => {
    expect(spokenCardLanguages()).toEqual(languageBase.approval_speech_words);
    expect(spokenWordsFor("de-DE", { now: NOW }).full).toBe(true);
    expect(spokenWordsFor("en", { now: NOW }).full).toBe(true);
    for (const language of ["fr", "es", "pl"])
      expect(spokenWordsFor(language, { now: NOW }).full).toBe(false);
  });

  it("a configured French table says the whole card with French words", () => {
    inject({ ...languageBase.approval_speech_words, fr: FRENCH });
    const french = spokenWordsFor("fr-FR", { now: NOW, timeZone: "UTC" });
    expect(french.full).toBe(true);
    expect(french.count(3)).toContain("trois");
    expect(french.count(3)).not.toContain("three");
    expect(dateDetail("fr", "2030-01-15")).toContain("15 janvier 2030");
    expect(dateDetail("fr", "2030-01-15T10:00:00")).toContain("10 heures");
    expect(dateDetail("fr", "2030-01-15T10:05:00")).toContain("10 h 05");
    // German and English stay as they were.
    expect(dateDetail("de", "2030-01-15T10:05:00")).toContain("10:05 Uhr");
    expect(spokenWordsFor("de", { now: NOW }).count(3)).toContain("drei");
  });

  it("a language without data says only the pointer, never English numbers", () => {
    inject({ ...languageBase.approval_speech_words, fr: FRENCH });
    const italian = spokenWordsFor("it", { now: NOW });
    expect(italian.full).toBe(false);
    expect(italian.count(3)).not.toContain("three");
    const configuredButNotJudged = { ...FRENCH, full_card: false };
    inject({
      ...languageBase.approval_speech_words,
      fr: configuredButNotJudged,
    });
    expect(spokenWordsFor("fr", { now: NOW }).full).toBe(false);
  });

  it("reads an instruction before a dictation in German, English and the card's language", () => {
    inject({ ...languageBase.approval_speech_words, fr: FRENCH });
    const text =
      "Merci pour votre message, nous livrons les pièces mardi prochain comme prévu.";
    const turns = [
      { text: `Écris au client: ${text}`, passages: [], whole: true },
    ].map((turn) => ({ ...turn, passages: [turn.text] }));
    expect(dictationOf(text, turns, "fr")).toBe("unchanged");
    expect(dictationOf(text, turns, "de")).toBe("part");
    expect(languagesHeard("fr").map((words) => words.locale)).toEqual([
      "de-DE",
      "en-GB",
      "fr-FR",
    ]);
    expect(languagesHeard("es").map((words) => words.locale)).toEqual([
      "de-DE",
      "en-GB",
    ]);
  });

  it("a locale Intl rejects falls back instead of breaking the card", () => {
    inject({
      ...languageBase.approval_speech_words,
      fr: { ...FRENCH, locale: "fr-ab1" },
    });
    expect(() => dateDetail("fr", "2030-01-15")).not.toThrow();
  });
});
