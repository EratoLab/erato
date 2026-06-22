/**
 * Centralized, annotated tunables for the client-side microphone-quality
 * probe (ERMAIN-380). Like {@link ./audioTuning} these are properties of
 * the acoustic analysis algorithm — identical across every deployment, not
 * cost/policy levers — so they live as frontend constants rather than being
 * plumbed through `erato.toml`.
 *
 * Pure data — no React, no DOM. Consumed by the pure `micQualityAnalysis`
 * module. Thresholds are sourced from controlled Whisper WER studies and
 * established meter implementations (cited inline); see ERMAIN-380.
 */

export type ClippingTuning = {
  clipLevel: number;
  minConsecutiveSamples: number;
  redRatio: number;
};
export type SnrTuning = {
  bandLowHz: number;
  bandHighHz: number;
  goodDb: number;
  marginalDb: number;
};
export type LevelTuning = {
  redDbfs: number;
  yellowDbfs: number;
};

/**
 * Clipping detector. A clip is a run of consecutive samples pinned at (or
 * past) full scale — the tell-tale flat-top of an overdriven capture. It is
 * the single highest-leverage WER factor (large hit, invisible to the user,
 * cheap to detect), so even a small amount is surfaced.
 */
export const CLIPPING_TUNING: ClippingTuning = {
  /**
   * Absolute sample magnitude at/above which a sample counts as clipped.
   * 0.98 (not 1.0) matches cwilso/volume-meter: some codecs/ADCs round the
   * flat top a hair below full scale, so a strict |x| >= 1.0 test misses
   * real clipping.
   */
  clipLevel: 0.98,

  /**
   * Minimum consecutive clipped samples before a run is flagged as a clip
   * event. Audacity's clipping detector requires >= 3 to avoid pinning on
   * isolated full-scale transients (a single percussive peak is not the
   * sustained flat-top that degrades transcription).
   */
  minConsecutiveSamples: 3,

  /**
   * Fraction of speech-phase samples inside clip events at/above which the
   * verdict goes red. Below this but > 0 events → yellow (audible but
   * recoverable). 0.5% of a ~3 s clip is ~240 ms of pinned samples — well
   * past "a stray peak", squarely in "turn the gain down" territory.
   */
  redRatio: 0.005,
} as const;

/**
 * Signal-to-noise ratio, the #1 real-world transcription driver. Measured
 * as band-passed speech-phase RMS over quiet-phase (noise-floor) RMS, both
 * restricted to the speech band so wideband rumble/hiss outside the band
 * doesn't distort the ratio. A steady-state verdict, not timeline events.
 */
export const SNR_TUNING: SnrTuning = {
  /** Speech-band low edge (Hz). Telephony band start; rejects HVAC/rumble. */
  bandLowHz: 300,
  /** Speech-band high edge (Hz). Telephony band end; rejects broadband hiss. */
  bandHighHz: 3400,

  /**
   * dB bands (AmirMahdyJebreily/Microphone-quality-evaluation + literature):
   * >= goodDb is clean, [marginalDb, goodDb) is usable-but-noisy (yellow),
   * < marginalDb is poor (red) — WER climbs steeply below ~10 dB and is
   * catastrophic by 0 dB.
   */
  goodDb: 20,
  marginalDb: 10,
} as const;

/**
 * Speech level. Too-quiet capture forces gain-up downstream (amplifying
 * noise) or drops below the model's effective floor. Reported in dBFS but
 * NEVER shown to the user as a number — it drives a plain-language hint.
 */
export const LEVEL_TUNING: LevelTuning = {
  /**
   * Speech RMS at/below which the verdict goes red ("move closer / raise
   * gain"). ~-40 dBFS is the commonly cited "too low" floor (Twilio
   * rtc-diagnostics low-audio test region).
   */
  redDbfs: -40,
  /**
   * Speech RMS at/below which the verdict goes yellow. Healthy dictation
   * sits around -18…-12 dBFS; by -30 the headroom for noise is thin.
   */
  yellowDbfs: -30,
} as const;

export type ActiveLevelTuning = {
  subWindowMs: number;
  percentile: number;
};

/**
 * Active-speech level estimation. Speech is bursty — natural pauses between
 * words mean a whole-window RMS is dominated by silence and badly
 * understates how loud the talker actually is, which would falsely flag a
 * perfectly usable mic as "very quiet". Instead we measure short-time RMS
 * over `subWindowMs` frames and take a high percentile, so the value
 * reflects the voiced portions (a robust, simpler cousin of ITU-T P.56
 * active speech level). Browser-agnostic, but it especially matters where
 * raw (AGC-off) capture is quieter — e.g. WebKit.
 */
export const ACTIVE_LEVEL_TUNING: ActiveLevelTuning = {
  /** Short-time window (~20 ms is the standard speech analysis frame). */
  subWindowMs: 20,
  /**
   * Percentile of sub-window energies taken as the active level. 0.9 ignores
   * inter-word silence and the odd transient while still requiring the
   * voiced fraction to exceed ~10% of the phase (true for any real reading).
   */
  percentile: 0.9,
};

/**
 * Floor substituted for log10(0) so a silent window maps to a finite, very
 * negative dBFS instead of -Infinity. -120 dBFS is below any real capture.
 */
export const SILENCE_FLOOR_DBFS = -120;
