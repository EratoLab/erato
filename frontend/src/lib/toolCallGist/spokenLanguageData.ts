import languageBase from "@/lib/generated/languageBase.json";

/**
 * One language's words for spoken approval cards: what a card says as code
 * (number words, ordinals, times, a value's direction) and the words the
 * user's own words are read with. The backend merges the built-in German and
 * English words with `[approval_speech.words.<language>]`; the built-in words
 * it generated into `languageBase.json` apply when none are passed.
 */
export interface SpokenCardLanguage {
  /** The locale `Intl` formats dates, numbers and lists in. */
  locale: string;
  /** Whether the whole card is said, not only the pointer sentence. */
  full_card: boolean;
  /** Number words for 0 to 12. */
  numbers: readonly string[];
  /** Ordinals for the first to the tenth. */
  ordinals: readonly string[];
  /** A full hour, with `{hour}`. */
  time_full_hour?: string;
  /** A time of day, with `{hour}` and a two-digit `{minute}`. */
  time?: string;
  /** An old value with its direction, with `{value}`. */
  from?: string;
  /** A new value with its direction, with `{value}`. */
  to?: string;
  dictation_verbs: readonly string[];
  dictation_words: readonly string[];
  difference_fillers: readonly string[];
}

export type SpokenCardLanguages = Partial<Record<string, SpokenCardLanguage>>;

/** The built-in German and English words. */
export const BUILT_IN_SPOKEN_CARD_LANGUAGES: SpokenCardLanguages =
  languageBase.approval_speech_words;

/** The phrase that approves a card by voice, as shown, by language. */
export type ConfirmationPhrases = Partial<Record<string, string>>;

/** The built-in German and English phrases. */
export const BUILT_IN_CONFIRMATION_PHRASES: ConfirmationPhrases =
  languageBase.confirmation_phrases;

/** "de-DE" or "de_DE" as "de". */
export const primaryLanguage = (language: string): string =>
  language.split(/[-_]/)[0]?.toLowerCase() ?? "en";

/**
 * The entry of `map` for `language` ("de-AT", "de_AT"): its whole tag in lower
 * case with a hyphen first, then its primary subtag ("de"), as the backend
 * looks language data up.
 */
export const byLanguageTag = <T>(
  map: Partial<Record<string, T>> | undefined,
  language: string,
): T | undefined =>
  map?.[language.trim().toLowerCase().replace(/_/g, "-")] ??
  map?.[primaryLanguage(language.trim())];

/** The words of `language` ("fr-CA" first, then "fr"), if it has any. */
export const spokenCardLanguage = (
  language: string,
  languages: SpokenCardLanguages = BUILT_IN_SPOKEN_CARD_LANGUAGES,
): SpokenCardLanguage | undefined => byLanguageTag(languages, language);

/**
 * The phrase a card in `language` approves with ("fr-CA" first, then "fr"),
 * if the language has one; a card without one is approved on screen.
 */
export const confirmationPhraseOf = (
  language: string,
  phrases: ConfirmationPhrases = BUILT_IN_CONFIRMATION_PHRASES,
): string | undefined => byLanguageTag(phrases, language);

/**
 * The languages whose words read what a user said about a card: German and
 * English, which people mix with any language, and the card's own. Without
 * a card language, every language with words.
 */
export const languagesHeard = (
  language?: string,
  languages: SpokenCardLanguages = BUILT_IN_SPOKEN_CARD_LANGUAGES,
): SpokenCardLanguage[] => {
  const heard =
    language === undefined
      ? Object.values(languages)
      : [languages.de, languages.en, spokenCardLanguage(language, languages)];
  return [...new Set(heard)].filter(
    (words): words is SpokenCardLanguage => words !== undefined,
  );
};

/** `locale` when `Intl` accepts it; the backend checks only its shape. */
export const intlLocale = (locale: string): string | undefined => {
  try {
    return Intl.getCanonicalLocales(locale).length > 0 ? locale : undefined;
  } catch {
    return undefined;
  }
};
