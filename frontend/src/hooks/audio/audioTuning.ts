/**
 * Centralized, annotated tunables for the client-side audio-capture
 * pipeline. These are properties of the browser onset-detection
 * algorithm — identical across every deployment — not cost/policy
 * levers, so they live here as frontend constants rather than being
 * plumbed through `erato.toml`.
 *
 * Pure data — no React, no DOM — shared by both recorder hooks and the
 * pure `onsetDetector` state machine; the mic-quality probe reuses the
 * same RMS/onset math, so keep the knobs in one place.
 */

/**
 * Synthetic silence prefix prepended to every session before captured
 * audio. Production streaming-STT VADs need ~300 ms of leading silence for
 * speech-onset calibration. Without it, a back-to-back second dictation
 * finds the OS audio device still hot, ships near-zero leading silence, and
 * the server's VAD trims the first word.
 */
export const PRE_SPEECH_SILENCE_PRIMER_MS = 300;

/**
 * Floor between `source.connect(processor)` and the visible
 * `isCapturingAudio` flip. On a fully-warm audio device the onset signal
 * can arrive in tens of milliseconds — fast enough that the spinner feels
 * like a blink and the user starts speaking before finishing the priming
 * breath. Holding the spinner at least this long gives a consistent
 * visual rhythm across cold and warm sessions.
 */
export const MIN_AUDIO_CAPTURE_DELAY_MS = 150;

/**
 * Grace window before a sustained `mute` on the capture `MediaStreamTrack`
 * is escalated to a device-loss. `mute`/`unmute` fire (browser-controlled,
 * distinct from the app-controlled `enabled`) when a source temporarily
 * can't produce data — on iOS/WebKit this happens during route changes and
 * interruptions (AirPods connect/disconnect, an incoming call, Siri), so a
 * naive "mute → error" false-positives on a transient that recovers. An
 * `unmute` inside this window cancels the escalation; only a mute that
 * outlives it is treated as lost (`ended` remains the authoritative,
 * immediate "dead" signal). `unmute` is not guaranteed to arrive — a route
 * change can mute with no unmute at all — so grace-expiry escalation is the
 * intended fallback, not an edge case.
 *
 * 5 s, not sub-second: a Bluetooth/AirPods reconfiguration can take up to
 * ~5 s, so a shorter window risks declaring "lost" mid-handoff on a slow
 * connect. Tradeoff: answering an incoming call holds the mic past 5 s, so
 * this surfaces a clean "interrupted" stop — the correct outcome, since
 * dictation can't continue mid-call.
 */
export const MUTE_GRACE_MS = 5_000;

/**
 * Tunables for the RMS-based speech-onset detector (ERMAIN-379). The
 * detector replaced an exact-zero predicate (`sample !== 0`) that
 * mistimed on WebKit/Safari, whose raw-capture path emits a low-level
 * noise floor / DC bias at stream start instead of bit-exact zeros, so
 * the old cue tripped on the warm-up floor ~1 s before real speech.
 */
export const ONSET_TUNING = {
  /**
   * Sub-window size (samples) for RMS. A received frame is 4096 samples
   * at the *track* sample rate, so one frame is ~85 ms at a 48 k track
   * but ~256 ms at a true-16 k track. Per-frame RMS would lag and average
   * short onsets away on 16 k devices; 512-sample sub-windows (~11–32 ms)
   * keep onset detection responsive regardless of track rate. 4096 is an
   * exact multiple of 512, so frames sub-divide cleanly.
   */
  subWindowSamples: 512,

  /**
   * Noise-floor calibration window, measured against the real incoming
   * captured frames (OS warm-up / room tone). Note the 300 ms primer is
   * injected zeros prepended only to the *server* stream and the 150 ms
   * min-delay only defers *displaying* the cue — neither buys real
   * calibration dead-time, so this window can overlap speech on a warm
   * back-to-back session where the user speaks immediately. In that case
   * the measured floor is inflated; the epsilon clamp (≤ 0.02) and the
   * 800 ms max-hold bound the resulting late-fire.
   */
  calibrationMs: 200,

  /**
   * epsilon = clamp(floorRMS × floorMultiplier, epsilonMin, epsilonMax).
   * 2.75× sits comfortably above a measured floor without reaching speech
   * energy. (The originally proposed 0.005–0.01 fixed threshold was too
   * low — it overlapped a noisy-room floor and re-introduced early-fire.)
   */
  floorMultiplier: 2.75,

  /** Lower clamp on epsilon (~−42 dBFS) — never trust a floor below this. */
  epsilonMin: 0.008,

  /**
   * Upper clamp on epsilon (~−34 dBFS) — a very noisy room still flips.
   * Tradeoff: in a room whose noise floor exceeds ~0.02 RMS, the cue
   * can early-fire on background noise (epsilon is capped below the floor).
   * Bounded and no worse than the old Chromium behaviour; revisit only if
   * UX flags false-positive onsets in loud environments.
   */
  epsilonMax: 0.02,

  /**
   * Fixed epsilon (≈ −37 dBFS) used when no calibration window is
   * captured (e.g. the first sub-window already exceeds threshold).
   */
  fixedFallbackEpsilon: 0.014,

  /**
   * Consecutive over-threshold sub-windows required to declare onset
   * (~22–64 ms depending on track rate). Debounces single-sub-window
   * transients.
   */
  consecutiveSubWindowsToFlip: 2,

  /**
   * Mandatory max-hold fallback. Unlike the old `!== 0` test, an RMS gate
   * can never trip on a near-silent input, so without this the spinner
   * would hang forever (UI-only, no data loss, but looks broken). Force
   * the onset flip after this much flowing audio regardless.
   *
   * NOTE: this is measured in AUDIO time — it only advances while the
   * worklet keeps posting frames. If frames stall entirely before onset
   * (a missed interruption, a stalled/ended track), this never fires; the
   * wall-clock backstop below is the frame-independent guarantee.
   */
  maxHoldMs: 800,

  /**
   * Frame-independent wall-clock backstop for the "speak now" cue.
   * `maxHoldMs` lives in audio time and freezes if frames stop arriving,
   * so a stalled capture would hang the spinner forever. This timer is
   * armed once at controller construction and force-flips the cue if
   * onset still hasn't fired. Set above `maxHoldMs` + first-frame latency
   * so the normal audio-time path always wins under live frame flow; it
   * only fires when delivery has genuinely stalled.
   *
   * Caveat: this only resolves the *cue*; it cannot tell a dead capture
   * from a flowing-but-quiet one — that needs track-health handling
   * (the capture-track device-loss watchdog).
   */
  wallClockBackstopMs: 1_200,
} as const;

export type OnsetTuning = typeof ONSET_TUNING;

/**
 * Speech the voice detector must count before a conversational turn can end.
 * It counts only frames it is fairly sure of: on synthetic voices the vowel
 * of "Stopp" (96 to 288 ms), "Ja" 290 to 380 ms, "Äh" and "um" 260 to
 * 350 ms; generated coughs and clicks scored nothing (real ones were not
 * measured). "Ja" and "Äh" overlap, so no minimum separates them: a turn of
 * hesitation sounds only is held back by its words instead (`hesitations.ts`).
 */
export const DEFAULT_MIN_SPEECH_MS = 250;

/**
 * The same while an approval card listens: its commands are the shortest
 * words there are, and the card's rules answer "mhm" and "okay" as noise.
 * Two detector frames.
 */
export const DEFAULT_CARD_MIN_SPEECH_MS = 64;

/** Same range the backend accepts for both; anything else falls back. */
const MIN_SPEECH_RANGE_MS = [32, 2000] as const;

export function resolveMinSpeechMs(
  value: number | undefined,
  fallback: number,
): number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= MIN_SPEECH_RANGE_MS[0] &&
    value <= MIN_SPEECH_RANGE_MS[1]
    ? value
    : fallback;
}

/**
 * Audio kept from before the detector is sure someone speaks; nothing older
 * is ever sent for transcription. Covers the detector's lead-in, as the
 * pre-speech pad of the server-side calibration does.
 */
export const BEFORE_SPEECH_KEPT_MS = 800;

/**
 * From this much audio in one piece on, a conversational turn is cut for
 * transcription at the next pause, so that no word is split. Only a speaker
 * who never pauses is cut at the server's piece length.
 */
export const CUT_AT_PAUSE_AFTER_MS = 20_000;

/** Frames the detector must hear as silence for a pause to count (about 64 ms). */
export const PAUSE_FRAMES = 2;

/** Below this the detector hears no speech in a frame (Silero v5 default). */
export const SILENT_FRAME_PROBABILITY = 0.25;

/** From this the detector hears speech in a frame (Silero v5 default). */
export const SPEECH_FRAME_PROBABILITY = 0.5;

/** The transcription connection is tried once more after this, the audio kept. */
export const SESSION_RETRY_DELAY_MS = 1_000;

/**
 * After a sound the detector rejected, the audio kept stops this long before
 * the end of the silence that ended it, so none of the sound stays.
 */
export const MISFIRE_MARGIN_MS = 100;

/** How long a turn's words may take to come back before it simply ends. */
export const HESITATION_CHECK_TIMEOUT_MS = 10_000;
