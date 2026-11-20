/* eslint-disable lingui/no-unlocalized-strings -- hesitation sounds as transcripts spell them, not copy */
/**
 * Whether a conversational turn's words are only hesitation sounds, which
 * end no turn. The list comes from the deployment
 * (`audio_conversational.hesitation_words`, merged with the base there, and
 * `audio_conversational.hesitations` of the interface language); without
 * one, the base below applies. Matching ignores case, punctuation
 * and drawn-out letters ("Ähhm…" is "ähm"). A number, or any other symbol
 * than punctuation, is a word: "Äh, 42." is an answer.
 */

/** The built-in German and English base, the same as the backend's. */
export const DEFAULT_HESITATION_WORDS = [
  "äh",
  "ähm",
  "aeh",
  "aehm",
  "öh",
  "öhm",
  "eh",
  "ehm",
  "hm",
  "mh",
  "uh",
  "uhm",
  "um",
  "erm",
];

const tokens = (text: string): string[] =>
  text
    .normalize("NFC")
    .toLowerCase()
    // Punctuation and spaces part words; letters, digits and symbols are
    // what was said.
    .split(/[\p{P}\p{Z}\s]+/u)
    .filter(Boolean)
    // A drawn-out sound is the same sound: "ähhhm", "hmmm", "ummm".
    .map((token) => token.replace(/(\p{L})\1+/gu, "$1"));

/**
 * The list for an interface in `language` ("fr-CA" first, then "fr"): its
 * own when the deployment has one, else the shared one.
 */
export const hesitationWordsFor = (
  language: string,
  shared: readonly string[] | undefined,
  byLanguage: Partial<Record<string, string[]>> | undefined,
): readonly string[] | undefined => {
  const tag = language.toLowerCase().replace(/_/g, "-");
  return byLanguage?.[tag] ?? byLanguage?.[tag.split("-")[0]] ?? shared;
};

export function hesitationMatcher(
  words: readonly string[] | undefined,
): (text: string) => boolean {
  const entries = Array.isArray(words) ? words : DEFAULT_HESITATION_WORDS;
  const list = new Set(
    entries
      .filter((word): word is string => typeof word === "string")
      .map(tokens)
      // One sound per entry: "äh ja" would make "Ja." a hesitation.
      .filter((parts) => parts.length === 1 && /^\p{L}+$/u.test(parts[0]))
      .map(([sound]) => sound),
  );
  return (text) => {
    const said = tokens(text);
    return said.length > 0 && said.every((token) => list.has(token));
  };
}
