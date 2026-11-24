/**
 * Whether the user is talking over the voice, read off the speech
 * probability the voice detector gives every frame. The voice's own sound
 * from the speakers, a cough or a short "mhm" must not stop it, so speech
 * over the voice counts only when the detector is far more certain than for
 * an ordinary turn, for at least `minSpeechMs` in one stretch.
 *
 * While such a stretch lasts but is still too short, the voice is lowered:
 * the user hears at once that they were heard, and a sound that ends early
 * costs a moment of quieter voice, not the rest of the reply.
 */

/** Far above the detector's own start threshold (0.3 for Silero v5). */
export const OVER_VOICE_SPEECH_PROBABILITY = 0.75;
/** A dip this short between syllables keeps the stretch going. */
export const OVER_VOICE_MAX_DIP_MS = 100;
export const DEFAULT_OVER_VOICE_MIN_SPEECH_MS = 300;
// Same range the backend accepts; anything else falls back to the default.
const MIN_OVER_VOICE_SPEECH_MS = 200;
const MAX_OVER_VOICE_SPEECH_MS = 2000;

export function resolveOverVoiceMinSpeechMs(value: number | undefined): number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= MIN_OVER_VOICE_SPEECH_MS &&
    value <= MAX_OVER_VOICE_SPEECH_MS
    ? value
    : DEFAULT_OVER_VOICE_MIN_SPEECH_MS;
}

export interface OverVoiceGate {
  /** Confident speech in the current stretch. */
  speechMs: number;
  /** Frames below the threshold since the stretch last had speech. */
  dipMs: number;
}

export const overVoiceGate = (): OverVoiceGate => ({ speechMs: 0, dipMs: 0 });

export interface OverVoiceStep {
  gate: OverVoiceGate;
  /** Speech may be starting: the voice is lowered while it lasts. */
  lowered: boolean;
  /** Speech lasted long enough: the voice yields. */
  confirmed: boolean;
}

export function overVoiceStep(
  gate: OverVoiceGate,
  probability: number,
  frameMs: number,
  minSpeechMs: number = DEFAULT_OVER_VOICE_MIN_SPEECH_MS,
): OverVoiceStep {
  let next: OverVoiceGate;
  if (probability >= OVER_VOICE_SPEECH_PROBABILITY) {
    next = { speechMs: gate.speechMs + frameMs, dipMs: 0 };
  } else if (
    gate.speechMs > 0 &&
    gate.dipMs + frameMs <= OVER_VOICE_MAX_DIP_MS
  ) {
    next = { speechMs: gate.speechMs, dipMs: gate.dipMs + frameMs };
  } else {
    next = overVoiceGate();
  }
  return {
    gate: next,
    lowered: next.speechMs > 0,
    confirmed: next.speechMs >= minSpeechMs,
  };
}

/**
 * Whether the user's speech went on once the voice had paused for it. The
 * voice's echo ends with the voice, after the output's own delay and the
 * room's ring, which are skipped; a person who cut in keeps talking.
 */
export const SPOKE_ON_SKIP_MS = 300;
export const SPOKE_ON_WINDOW_MS = 600;
export const SPOKE_ON_SPEECH_MS = 200;

export interface SpokeOn {
  /** Skipped after the pause: the room's ring and the output's delay. */
  skipMs: number;
  /** Since the voice paused. */
  sinceMs: number;
  /** Speech in the window after the skipped start. */
  speechMs: number;
}

/** `outputDelayMs`: how late the device plays what the page sends it. */
export const spokeOnStart = (outputDelayMs = 0): SpokeOn => ({
  skipMs:
    SPOKE_ON_SKIP_MS +
    (Number.isFinite(outputDelayMs) ? Math.max(0, outputDelayMs) : 0),
  sinceMs: 0,
  speechMs: 0,
});

export function spokeOnStep(
  state: SpokeOn,
  probability: number,
  frameMs: number,
): SpokeOn {
  const sinceMs = state.sinceMs + frameMs;
  const inWindow =
    sinceMs > state.skipMs && sinceMs <= state.skipMs + SPOKE_ON_WINDOW_MS;
  return {
    ...state,
    sinceMs,
    speechMs:
      inWindow && probability >= OVER_VOICE_SPEECH_PROBABILITY
        ? state.speechMs + frameMs
        : state.speechMs,
  };
}

export const spokeOn = (state: SpokeOn | null): boolean =>
  state !== null && state.speechMs >= SPOKE_ON_SPEECH_MS;
