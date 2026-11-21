import { afterEach, describe, expect, it } from "vitest";

import { deploymentConfirmationPhrases } from "@/hooks/audio/confirmationPhrases";
import { deploymentSpokenCardLanguages } from "@/hooks/audio/spokenStyle";
import languageBase from "@/lib/generated/languageBase.json";

import { spokenWordsFor } from "./spokenCardWords";
import { dictationOf } from "./spokenDictation";
import {
  byLanguageTag,
  confirmationPhraseOf,
  languagesHeard,
  spokenCardLanguage,
} from "./spokenLanguageData";
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

const WITH_FRENCH: SpokenCardLanguages = {
  ...languageBase.approval_speech_words,
  fr: FRENCH,
};

afterEach(() => {
  window.APPROVAL_SPEECH_WORDS = undefined;
  window.APPROVAL_VOICE_PHRASES = undefined;
});

const dateDetail = (
  language: string,
  written: string,
  spokenCardLanguages: SpokenCardLanguages = WITH_FRENCH,
) =>
  spokenWordsFor(language, {
    now: NOW,
    timeZone: "UTC",
    spokenCardLanguages,
  }).detail(
    { type: "set", field: "Date", value: earValue(written), loss: false },
    { action: "create" } as SpokenFacts,
  );

describe("language data for spoken cards", () => {
  it("without an injected environment, the generated built-in words apply", () => {
    expect(deploymentSpokenCardLanguages()).toEqual(
      languageBase.approval_speech_words,
    );
    window.APPROVAL_SPEECH_WORDS = WITH_FRENCH;
    expect(deploymentSpokenCardLanguages()).toBe(WITH_FRENCH);
    expect(spokenWordsFor("de-DE", { now: NOW }).full).toBe(true);
    expect(spokenWordsFor("en", { now: NOW }).full).toBe(true);
    for (const language of ["fr", "es", "pl"])
      expect(spokenWordsFor(language, { now: NOW }).full).toBe(false);
  });

  it("a configured French table says the whole card with French words", () => {
    const french = spokenWordsFor("fr-FR", {
      now: NOW,
      timeZone: "UTC",
      spokenCardLanguages: WITH_FRENCH,
    });
    expect(french.full).toBe(true);
    expect(french.count(3)).toContain("trois");
    expect(french.count(3)).not.toContain("three");
    expect(dateDetail("fr", "2030-01-15")).toContain("15 janvier 2030");
    expect(dateDetail("fr", "2030-01-15T10:00:00")).toContain("10 heures");
    expect(dateDetail("fr", "2030-01-15T10:05:00")).toContain("10 h 05");
    expect(dateDetail("de", "2030-01-15T10:05:00")).toContain("10:05 Uhr");
    expect(
      spokenWordsFor("de", {
        now: NOW,
        spokenCardLanguages: WITH_FRENCH,
      }).count(3),
    ).toContain("drei");
  });

  it("a language without data says only the pointer, never English numbers", () => {
    const italian = spokenWordsFor("it", {
      now: NOW,
      spokenCardLanguages: WITH_FRENCH,
    });
    expect(italian.full).toBe(false);
    expect(italian.count(3)).not.toContain("three");
    const configuredButNotJudged = { ...FRENCH, full_card: false };
    expect(
      spokenWordsFor("fr", {
        now: NOW,
        spokenCardLanguages: {
          ...languageBase.approval_speech_words,
          fr: configuredButNotJudged,
        },
      }).full,
    ).toBe(false);
  });

  it("a regional language uses its own table, else its primary language's", () => {
    const languages: SpokenCardLanguages = {
      ...WITH_FRENCH,
      "pt-br": { ...FRENCH, locale: "pt-BR" },
    };
    for (const language of ["fr", "fr-FR", "fr-CA", "fr_BE"])
      expect(spokenCardLanguage(language, languages)?.locale).toBe("fr-FR");
    expect(spokenCardLanguage("pt-BR", languages)?.locale).toBe("pt-BR");
    expect(spokenCardLanguage("pt", languages)).toBeUndefined();
    expect(spokenCardLanguage("de-AT")?.locale).toBe("de-DE");
  });

  it("reads an instruction before a dictation in German, English and the card's language", () => {
    const text =
      "Merci pour votre message, nous livrons les pièces mardi prochain comme prévu.";
    const turns = [
      { text: `Écris au client: ${text}`, passages: [], whole: true },
    ].map((turn) => ({ ...turn, passages: [turn.text] }));
    expect(dictationOf(text, turns, "fr", WITH_FRENCH)).toBe("unchanged");
    expect(dictationOf(text, turns, "de", WITH_FRENCH)).toBe("part");
    expect(dictationOf(text, turns, undefined, WITH_FRENCH)).toBe("unchanged");
    expect(dictationOf(text, turns)).toBe("part");
    expect(
      languagesHeard("fr", WITH_FRENCH).map((words) => words.locale),
    ).toEqual(["de-DE", "en-GB", "fr-FR"]);
    expect(
      languagesHeard("es", WITH_FRENCH).map((words) => words.locale),
    ).toEqual(["de-DE", "en-GB"]);
  });

  it("a locale Intl rejects falls back instead of breaking the card", () => {
    expect(() =>
      dateDetail("fr", "2030-01-15", {
        ...languageBase.approval_speech_words,
        fr: { ...FRENCH, locale: "fr-ab1" },
      }),
    ).not.toThrow();
  });

  it("names the confirmation phrase of the card's language, else the English one", () => {
    expect(deploymentConfirmationPhrases()).toEqual(
      languageBase.confirmation_phrases,
    );
    expect(confirmationPhraseOf("de-AT")).toBe("Ich bestätige");
    expect(confirmationPhraseOf("fr")).toBeUndefined();
    const phrases = {
      ...languageBase.confirmation_phrases,
      fr: "Je confirme",
    };
    window.APPROVAL_VOICE_PHRASES = phrases;
    expect(deploymentConfirmationPhrases()).toBe(phrases);
    expect(confirmationPhraseOf("fr_CA", phrases)).toBe("Je confirme");
    const said = (language: string) => {
      const words = spokenWordsFor(language, {
        now: NOW,
        spokenCardLanguages: WITH_FRENCH,
        confirmationPhrases: phrases,
      });
      return [
        words.request(true),
        words.notice({ kind: "say_phrase" }),
        words.notice({ kind: "say_phrase_again" }),
      ].join(" ");
    };
    expect(said("fr")).toContain("Je confirme");
    expect(said("fr")).not.toContain("I confirm");
    expect(said("en")).toContain("I confirm");
    expect(said("es")).toContain("I confirm");
    expect(said("es")).not.toContain("{phrase}");
  });
});

describe("byLanguageTag", () => {
  it("finds a region's own entry, then its primary language's, as the backend does", () => {
    const map = { de: 1, "de-at": 2 };
    expect(byLanguageTag(map, "de_AT")).toBe(2);
    expect(byLanguageTag(map, " DE-at ")).toBe(2);
    expect(byLanguageTag(map, "de-CH")).toBe(1);
    expect(byLanguageTag(map, "fr")).toBeUndefined();
    expect(byLanguageTag(undefined, "de")).toBeUndefined();
  });
});
