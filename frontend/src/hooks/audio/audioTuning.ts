/**
 * Centralized, annotated tunables for the client-side audio-capture
 * pipeline. These are properties of the browser onset-detection
 * algorithm — identical across every deployment — not cost/policy
 * levers, so they live here as frontend constants rather than being
 * plumbed through `erato.toml`. (Investigated on ERMAIN-379: the backend
 * `AudioTranscriptionConfig` carries only server-side STT/LLM tuning; no
 * onset/VAD/calibration field exists, and only `enabled` +
 * `max_recording_duration_seconds` ever reach the frontend.)
 *
 * Pure data — no React, no DOM — shared by both recorder hooks and the
 * pure `onsetDetector` state machine. ERMAIN-380 (mic-quality probe)
 * reuses the same RMS/onset math, so keep the knobs in one place.
 */

/**
 * Synthetic silence prefix prepended to every session before captured
 * audio. Mirrors what production streaming-STT VADs require for
 * speech-onset calibration (OpenAI Realtime `prefix_padding_ms` defaults
 * to 300 ms; Silero `speech_pad_ms` / sherpa-onnx pre-speech padding land
 * in the same range). Without it, a back-to-back second dictation finds
 * the OS audio device still hot, ships near-zero leading silence, and the
 * server's VAD trims the first word (ERMAIN-334).
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

  /** Upper clamp on epsilon (~−34 dBFS) — a very noisy room still flips. */
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
   */
  maxHoldMs: 800,
} as const;

export type OnsetTuning = typeof ONSET_TUNING;
