import BUILT_IN from "./builtInStopWords.json";
import { foldSpokenWords } from "./spokenWords";

/**
 * What a turn said over a reply's voice is: a stop for the voice ("Stopp",
 * "Nein, hör auf"), the voice's own echo that got past echo cancellation,
 * nothing that asks for anything ("Okay.", "Mhm"), or the user's next
 * message.
 *
 * The words are the backend's card voice commands with what language
 * packages add, sent as `AUDIO_CONVERSATIONAL_STOP_WORDS`, and read the way
 * its rules read a card's: split at punctuation, fillers dropped, each
 * segment a stop, a leading "no" or listening noise. Without the
 * environment the built-in lists apply (`builtInStopWords.json`, kept equal
 * to the backend's by a backend test).
 */

export type OverVoiceTurn = "empty" | "stop" | "echo" | "message";

export interface StopWords {
  stop: readonly string[];
  fillers: readonly string[];
  noise_words: readonly string[];
  noise_phrases: readonly string[];
  leading_no: readonly string[];
  yes_particles: readonly string[];
}

export const BUILT_IN_STOP_WORDS: StopWords = BUILT_IN;

/**
 * Words that only repeat the voice are its echo when they are covered this
 * much by stretches of what it was saying.
 */
export const ECHO_COVERAGE = 0.6;

/** Where the backend's rules cut a turn into segments. */
const SEGMENT_BREAK = /[,.;:!?…–—()]/u;

type Segment =
  | { kind: "stop"; stop: string }
  | { kind: "no" }
  | { kind: "quiet" }
  | { kind: "other" };

const segmentReader = (words: StopWords) => {
  const fillers = new Set(words.fillers.flatMap(foldSpokenWords));
  const keep = (said: string[]) => said.filter((word) => !fillers.has(word));
  const stops = new Set(
    words.stop.map((phrase) => keep(foldSpokenWords(phrase)).join(" ")),
  );
  const noiseWords = new Set(words.noise_words.flatMap(foldSpokenWords));
  const noisePhrases = new Set(
    words.noise_phrases.map((phrase) => foldSpokenWords(phrase).join(" ")),
  );
  const leadingNo = new Set(words.leading_no.flatMap(foldSpokenWords));
  const yesParticles = new Set(words.yes_particles.flatMap(foldSpokenWords));
  return (segment: string): Segment => {
    const said = keep(foldSpokenWords(segment));
    if (said.length === 0) return { kind: "quiet" };
    const joined = said.join(" ");
    if (stops.has(joined)) return { kind: "stop", stop: joined };
    let first = 0;
    while (first < said.length && leadingNo.has(said[first])) first += 1;
    if (first === said.length) return { kind: "no" };
    const rest = said.slice(first).join(" ");
    if (first > 0 && stops.has(rest)) return { kind: "stop", stop: rest };
    // A listener's "ja" or "mhm" asks for nothing.
    if (
      said.every((word) => noiseWords.has(word) || yesParticles.has(word)) ||
      noisePhrases.has(joined)
    )
      return { kind: "quiet" };
    return { kind: "other" };
  };
};

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

/**
 * One spoken word heard by the recognizer twice. `strict`: only a letter
 * apart, so that "momentan" said by the voice is not "Moment!" said by the
 * user.
 */
const sameWord = (a: string, b: string, strict = false): boolean => {
  if (a === b) return true;
  const shorter = Math.min(a.length, b.length);
  if (shorter < 4) return false;
  if (strict) return editDistance(a, b) <= 1;
  if (a.slice(0, 4) === b.slice(0, 4) && Math.abs(a.length - b.length) <= 2)
    return true;
  return editDistance(a, b) <= (shorter >= 6 ? 2 : 1);
};

/**
 * How much of `said` is made of stretches that also stand in `voice` word
 * for word, a slightly misheard word still counting: two words or more, or
 * the one word of a one-word turn.
 */
export function echoCoverage(
  said: string[],
  voice: string[],
  strict = false,
): number {
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
        sameWord(said[from + length], voice[at + length], strict)
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
    stopWords = BUILT_IN_STOP_WORDS,
  }: { voiceText: string; spokeOn: boolean; stopWords?: StopWords },
): OverVoiceTurn {
  const read = segmentReader(stopWords);
  const segments = text
    .split(SEGMENT_BREAK)
    .map(read)
    .filter((segment) => segment.kind !== "quiet");
  if (segments.length === 0) return "empty";
  const voice = spokeOn ? [] : foldSpokenWords(voiceText);
  const stops = segments.flatMap((segment) =>
    segment.kind === "stop" ? [segment.stop] : [],
  );
  if (stops.length > 0 && segments.every((segment) => segment.kind !== "other"))
    // The voice saying "Einen Moment …" must not stop itself.
    return stops.every(
      (stop) => echoCoverage(foldSpokenWords(stop), voice, true) === 1,
    )
      ? "echo"
      : "stop";
  if (echoCoverage(foldSpokenWords(text), voice) >= ECHO_COVERAGE)
    return "echo";
  return "message";
}
