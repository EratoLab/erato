import { foldSpokenWords } from "./spokenWords";

/**
 * What a turn said over a reply's voice is: nothing (a cough, a noise), the
 * voice's own echo that got past echo cancellation, or the user's next
 * message, whatever its words.
 */
export type OverVoiceTurn = "empty" | "echo" | "message";

/**
 * Words that only repeat the voice are its echo when they are covered this
 * much by stretches of what it was saying.
 */
export const ECHO_COVERAGE = 0.6;

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
 * How much of `said` is made of stretches that also stand in `voice` word
 * for word, a slightly misheard word still counting: two words or more, or
 * the one word of a one-word turn.
 */
export function echoCoverage(said: string[], voice: string[]): number {
  if (said.length === 0 || voice.length === 0) return 0;
  const minRun = said.length === 1 ? 1 : 2;
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
  { voiceText, spokeOn }: { voiceText: string; spokeOn: boolean },
): OverVoiceTurn {
  const said = foldSpokenWords(text);
  if (said.length === 0) return "empty";
  if (
    !spokeOn &&
    echoCoverage(said, foldSpokenWords(voiceText)) >= ECHO_COVERAGE
  )
    return "echo";
  return "message";
}
