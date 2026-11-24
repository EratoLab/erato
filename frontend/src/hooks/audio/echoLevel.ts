/**
 * Whether the microphone heard more than the voice's own echo. The speech
 * detector hardly cares how loud speech is: the voice coming back from the
 * speakers, even far below the user, sounds like speech to it. What tells
 * them apart is loudness against what the voice itself is playing. The
 * microphone hears the room's own sound plus the echo, which rises and falls
 * with the voice at a strength this device and room give it; both are
 * measured here while the voice plays, and the user adds sound on top.
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
 * The echo is learned over this long while the voice plays: long enough to
 * hold its loud syllables, short enough to follow a change of volume.
 */
const WINDOW_MS = 3000;
/** The fewest frames whose spread says anything. */
const MIN_FRAMES = 10;
/**
 * A frame holds the user when it rises above what echo and room explain by
 * more than all but one in twenty of the frames that held only those: an
 * echo alone then passes single frames at most, never the stretch the gate
 * needs.
 */
const SPREAD_PERCENTILE = 0.95;
/** The room's own sound: what the microphone hears at its quietest. */
const ROOM_PERCENTILE = 0.1;
/**
 * Below this the voice's own audio is silent (about -60 dBFS of the samples
 * it plays): nothing can come back.
 */
const VOICE_SILENT = 0.001;

export interface EchoCoupling {
  /** Heard and played levels of recent frames that held echo and room only. */
  learned: { heard: number; played: number }[];
  /** Recent levels heard, for the room's own sound. */
  heard: number[];
}

export const echoCoupling = (): EchoCoupling => ({ learned: [], heard: [] });

const percentile = (values: readonly number[], share: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))];
};

/**
 * What the learned frames say: the room's level, how strongly the voice
 * comes back (from the louder half of them, where the echo stands above the
 * room), and how far frames of echo and room alone stray from that.
 */
function expectation(learned: EchoCoupling["learned"], room: number) {
  const louder = percentile(
    learned.map((frame) => frame.played),
    0.5,
  );
  const strength = percentile(
    learned
      .filter((frame) => frame.played >= louder)
      .map((frame) => Math.max(0, frame.heard - room) / frame.played),
    0.5,
  );
  const spread = percentile(
    learned.map((frame) => frame.heard - room - strength * frame.played),
    SPREAD_PERCENTILE,
  );
  return { strength, spread: Math.max(0, spread) };
}

/**
 * One microphone frame: `heard` its level, `played` the loudest the voice
 * played in the time its echo can come from. `learn`: the frame is not part
 * of a stretch that may be the user's, so it shows echo and room alone.
 * `overEcho`: the frame holds more than they explain, and at least as much
 * again as the echo itself; with the voice silent, always.
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
  let overEcho = false;
  if (coupling.learned.length >= MIN_FRAMES) {
    const room = percentile(heardLevels, ROOM_PERCENTILE);
    const { strength, spread } = expectation(coupling.learned, room);
    const echo = strength * played;
    overEcho = heard - room - echo > Math.max(spread, echo);
  }
  return {
    coupling: {
      heard: heardLevels,
      learned: learn
        ? [...coupling.learned.slice(-(kept - 1)), { heard, played }]
        : coupling.learned,
    },
    overEcho,
  };
}

export function frameLevel(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
}
