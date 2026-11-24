/**
 * Whether the microphone heard more than the voice's own echo. The speech
 * detector hardly cares how loud speech is: the voice coming back from the
 * speakers, even far below the user, sounds like speech to it. What tells
 * them apart is loudness against what the voice itself is playing. The echo
 * rises and falls with it, at a strength this device and room give it,
 * measured here while the voice plays; the user adds sound on top.
 */

/**
 * How far back the voice can come in again beyond what the output reports:
 * Bluetooth and the room (up to about 300 ms), the microphone's buffering.
 */
export const ECHO_LAG_MS = 600;
/**
 * Frames are timed with the input latency counted at its least likely
 * longest; the echo may be this much later than that.
 */
export const ECHO_LEAD_MS = 150;
/**
 * The echo's strength is learned over this long while the voice plays:
 * long enough to hold its loud syllables, short enough to follow a change
 * of volume.
 */
const WINDOW_MS = 3000;
/** The fewest frames whose spread says anything. */
const MIN_FRAMES = 10;
/**
 * A frame holds the user when it is louder against the voice than all but
 * one in twenty of the echo's own frames: an echo alone then passes single
 * frames at most, never the stretch the gate needs.
 */
const ECHO_PERCENTILE = 0.95;
/**
 * And at least as loud again as the echo's middle: two equal sounds add up
 * to about 1.4 times one, so the user must at least match the echo.
 */
const OVER_ECHO = 2;
/** The room's own sound: what the microphone hears at its quietest. */
const FLOOR_PERCENTILE = 0.1;
/**
 * Below this the voice's own audio is silent (about -60 dBFS of the samples
 * it plays): nothing can come back.
 */
const VOICE_SILENT = 0.001;

export interface EchoCoupling {
  /** Heard above the room against played, while only the voice played. */
  ratios: number[];
  /** Recent levels heard, for the room's floor. */
  heard: number[];
}

export const echoCoupling = (): EchoCoupling => ({ ratios: [], heard: [] });

const percentile = (values: readonly number[], share: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))];
};

/**
 * One microphone frame: `heard` its level, `played` the loudest the voice
 * played in the time its echo can come from. `learn`: the frame is not part
 * of a stretch that may be the user's, so it shows the echo alone.
 * `overEcho`: the frame holds more than the echo; with the voice silent,
 * always.
 */
export function noteEchoFrame(
  coupling: EchoCoupling,
  {
    heard,
    played,
    frameMs,
    learn,
  }: {
    heard: number;
    played: number;
    frameMs: number;
    learn: boolean;
  },
): { coupling: EchoCoupling; overEcho: boolean } {
  const kept = Math.max(MIN_FRAMES, Math.ceil(WINDOW_MS / frameMs));
  const heardLevels = [...coupling.heard.slice(-(kept - 1)), heard];
  if (!(played > VOICE_SILENT))
    return { coupling: { ...coupling, heard: heardLevels }, overEcho: true };
  const floor = percentile(heardLevels, FLOOR_PERCENTILE);
  const ratio = Math.max(0, heard - floor) / played;
  const known = coupling.ratios.length >= MIN_FRAMES;
  const overEcho =
    known &&
    ratio > percentile(coupling.ratios, ECHO_PERCENTILE) &&
    ratio >= OVER_ECHO * percentile(coupling.ratios, 0.5);
  return {
    coupling: {
      heard: heardLevels,
      ratios: learn
        ? [...coupling.ratios.slice(-(kept - 1)), ratio]
        : coupling.ratios,
    },
    overEcho,
  };
}

export function frameLevel(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
}
