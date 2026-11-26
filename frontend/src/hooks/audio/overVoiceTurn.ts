import { numbersSaid } from "@/lib/toolCallGist/spokenNumbers";

import { foldSpokenWords } from "./spokenWords";

import type { NumberWords } from "@/lib/toolCallGist/spokenNumbers";

/**
 * What a turn said over a reply's voice is: nothing (a cough, a noise), the
 * voice's own echo that got past echo cancellation, or the user's next
 * message, whatever its words.
 */
export type OverVoiceTurn = "empty" | "echo" | "message";

/**
 * Words that only repeat the voice are its echo when they are covered this
 * much by stretches of what it was saying, each at least `ECHO_RUN` words
 * long: an echo held back from before the speech was confirmed runs to
 * several words, while a short question ("Schneider?") that picks up one
 * word of the voice is the person's.
 */
export const ECHO_COVERAGE = 0.6;
export const ECHO_RUN = 3;

/**
 * The words compared for echo. Numbers are left out on both sides: the
 * recognizer writes "48.500" as "48500" or in words, and a time or an amount
 * alone says little about where the words came from.
 */
const comparedWords = (text: string, numberWords?: NumberWords): string[] =>
  foldSpokenWords(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => {
        if (word.length < 2 || /\p{N}/u.test(word)) return false;
        const read = numbersSaid([word], numberWords);
        return read.sure.size === 0 && read.maybe.size === 0;
      })
      .join(" "),
  );

const editDistance = (a: string, b: string): number => {
  let previous = Array.from({ length: b.length + 1 }, (_, at) => at);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1)
      row[j] = Math.min(
        previous[j] + 1,
        row[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    previous = row;
  }
  return previous[b.length];
};

/** One spoken word heard by the recognizer twice. */
const sameWord = (a: string, b: string): boolean => {
  if (a === b) return true;
  const shorter = Math.min(a.length, b.length);
  if (shorter < 4) return false;
  if (a.slice(0, 4) === b.slice(0, 4) && Math.abs(a.length - b.length) <= 2)
    return true;
  return editDistance(a, b) <= (shorter >= 6 ? 2 : 1);
};

/**
 * How much of `said` is made of stretches of `ECHO_RUN` words or more that
 * also stand in `voice` word for word, a slightly misheard word still
 * counting.
 */
export function echoCoverage(said: string[], voice: string[]): number {
  if (said.length < ECHO_RUN || voice.length === 0) return 0;
  const minRun = ECHO_RUN;
  const covered = new Array<boolean>(said.length).fill(false);
  for (let from = 0; from < said.length; from += 1) {
    let longest = 0;
    for (let at = 0; at < voice.length; at += 1) {
      let length = 0;
      while (
        from + length < said.length &&
        at + length < voice.length &&
        sameWord(said[from + length], voice[at + length])
      )
        length += 1;
      longest = Math.max(longest, length);
    }
    if (longest >= minRun)
      for (let offset = 0; offset < longest; offset += 1)
        covered[from + offset] = true;
  }
  return covered.filter(Boolean).length / said.length;
}

/**
 * `voiceText`: what the voice was saying when the user talked over it, empty
 * when nothing was sounding. `spokeOn`: the user's speech went on once the
 * voice had paused; an echo ends with the voice, so such a turn is the
 * user's even where it quotes the reply.
 */
export function classifyOverVoiceTurn(
  text: string,
  {
    voiceText,
    spokeOn,
    numberWords,
  }: { voiceText: string; spokeOn: boolean; numberWords?: NumberWords },
): OverVoiceTurn {
  if (foldSpokenWords(text).length === 0) return "empty";
  if (
    !spokeOn &&
    echoCoverage(
      comparedWords(text, numberWords),
      comparedWords(voiceText, numberWords),
    ) >= ECHO_COVERAGE
  )
    return "echo";
  return "message";
}
