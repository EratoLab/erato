/* eslint-disable lingui/no-unlocalized-strings -- hesitation sounds as transcripts spell them, not copy */
/**
 * Whether a conversational turn's words are only hesitation sounds, which
 * end no turn. The words come from `audio_conversational.hesitation_words`;
 * a deployment or package extends that list. Matching ignores case,
 * punctuation and drawn-out letters ("Ähhm…" is "ähm").
 */

/** The built-in base when the deployment sets no list. */
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
  "mhm",
  "mh",
  "uh",
  "uhm",
  "um",
  "er",
  "erm",
];

const tokens = (text: string): string[] =>
  text
    .normalize("NFC")
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter(Boolean)
    // A drawn-out sound is the same sound: "ähhhm", "hmmm", "ummm".
    .map((token) => token.replace(/(\p{L})\1+/gu, "$1"));

export function hesitationMatcher(
  words: readonly string[] | undefined,
): (text: string) => boolean {
  const list = new Set(
    (Array.isArray(words) ? words : DEFAULT_HESITATION_WORDS)
      .filter((word): word is string => typeof word === "string")
      .flatMap(tokens),
  );
  return (text) => {
    const said = tokens(text);
    return said.length > 0 && said.every((token) => list.has(token));
  };
}
