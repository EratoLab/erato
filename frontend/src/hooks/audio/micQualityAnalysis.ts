/**
 * Pure microphone-quality analysis for the guided mic-check (ERMAIN-380).
 *
 * Consumes the captured quiet-phase and speech-phase PCM (Float32, [-1, 1])
 * and derives the deterministic acoustic metrics that — and ONLY which —
 * drive the traffic-light verdict: clipping point-events, band-passed SNR,
 * and speech level. The transcript is never an input here: a flaky
 * LLM transcript on good audio must never blame the user's mic (ERMAIN-380).
 *
 * No React, no DOM, no `Date.now()` — fully deterministic and unit-testable
 * against recorded/synthetic fixtures, mirroring `onsetDetector`.
 */

import {
  CLIPPING_TUNING,
  LEVEL_TUNING,
  SILENCE_FLOOR_DBFS,
  SNR_TUNING,
  type ClippingTuning,
  type LevelTuning,
  type SnrTuning,
} from "./micQualityTuning";

export type MicQualityVerdict = "good" | "fair" | "poor";

/**
 * The single primary issue surfaced to the user (one at a time, per the
 * single-screen UX). `null` means no issue worth flagging — the capture is
 * good. Ranked by transcription-WER leverage: clipping > noise > level.
 */
export type MicQualityIssue = "clipping" | "background-noise" | "low-level";

/** A run of consecutive clipped samples, in speech-phase sample indices. */
export type ClipEvent = {
  /** Index of the first clipped sample in the run (speech-phase frame). */
  startSample: number;
  /** Index one past the last clipped sample in the run. */
  endSample: number;
};

export type ClippingResult = {
  events: ClipEvent[];
  /** Total samples inside clip events. */
  clippedSampleCount: number;
  /** clippedSampleCount / total speech samples, in [0, 1]. */
  clippedRatio: number;
};

export type MicQualityMetrics = {
  clipping: ClippingResult;
  /** Band-passed speech-over-noise ratio in dB. */
  snrDb: number;
  /** Band-passed quiet-phase RMS in dBFS (noise floor). */
  noiseFloorDbfs: number;
  /** Full-band speech-phase RMS in dBFS. */
  speechLevelDbfs: number;
};

export type MicQualityAssessment = {
  verdict: MicQualityVerdict;
  /** `null` when the capture is good and there is nothing to flag. */
  primaryIssue: MicQualityIssue | null;
  metrics: MicQualityMetrics;
};

type Severity = "ok" | "warn" | "bad";

const SEVERITY_TO_VERDICT: Record<Severity, MicQualityVerdict> = {
  ok: "good",
  warn: "fair",
  bad: "poor",
};

/** Converts a linear RMS amplitude in [0, 1] to dBFS, clamped at the floor. */
export function rmsToDbfs(rms: number): number {
  if (!(rms > 0)) {
    return SILENCE_FLOOR_DBFS;
  }
  return Math.max(SILENCE_FLOOR_DBFS, 20 * Math.log10(rms));
}

/**
 * Detects clipping as runs of >= `minConsecutiveSamples` samples whose
 * magnitude reaches `clipLevel`. Returns the runs as point-events (for
 * timeline markers) plus the clipped-sample ratio (for the verdict).
 */
export function detectClipping(
  samples: Float32Array,
  tuning: ClippingTuning = CLIPPING_TUNING,
): ClippingResult {
  const events: ClipEvent[] = [];
  let clippedSampleCount = 0;
  let runStart = -1;

  const flushRun = (end: number) => {
    if (runStart >= 0) {
      const runLength = end - runStart;
      if (runLength >= tuning.minConsecutiveSamples) {
        events.push({ startSample: runStart, endSample: end });
        clippedSampleCount += runLength;
      }
      runStart = -1;
    }
  };

  for (let index = 0; index < samples.length; index += 1) {
    if (Math.abs(samples[index]) >= tuning.clipLevel) {
      if (runStart < 0) {
        runStart = index;
      }
    } else {
      flushRun(index);
    }
  }
  flushRun(samples.length);

  const clippedRatio =
    samples.length > 0 ? clippedSampleCount / samples.length : 0;

  return { events, clippedSampleCount, clippedRatio };
}

type BiquadCoefficients = {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
};

/** RBJ cookbook second-order Butterworth (Q = 1/√2) low/high-pass. */
function biquadCoefficients(
  kind: "lowpass" | "highpass",
  cutoffHz: number,
  sampleRate: number,
): BiquadCoefficients {
  const w0 = (2 * Math.PI * cutoffHz) / sampleRate;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const alpha = sinW0 / Math.SQRT2;
  const a0 = 1 + alpha;

  if (kind === "lowpass") {
    const b1 = (1 - cosW0) / a0;
    return {
      b0: (1 - cosW0) / 2 / a0,
      b1,
      b2: (1 - cosW0) / 2 / a0,
      a1: (-2 * cosW0) / a0,
      a2: (1 - alpha) / a0,
    };
  }
  const b1 = -(1 + cosW0) / a0;
  return {
    b0: (1 + cosW0) / 2 / a0,
    b1,
    b2: (1 + cosW0) / 2 / a0,
    a1: (-2 * cosW0) / a0,
    a2: (1 - alpha) / a0,
  };
}

/** Direct-form-I biquad applied in place over a copy of the input. */
function applyBiquad(
  samples: Float32Array,
  coefficients: BiquadCoefficients,
): Float32Array {
  const output = new Float32Array(samples.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const x0 = samples[index];
    const y0 =
      coefficients.b0 * x0 +
      coefficients.b1 * x1 +
      coefficients.b2 * x2 -
      coefficients.a1 * y1 -
      coefficients.a2 * y2;
    output[index] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return output;
}

function rms(samples: Float32Array): number {
  if (samples.length === 0) {
    return 0;
  }
  let squaredTotal = 0;
  for (let index = 0; index < samples.length; index += 1) {
    squaredTotal += samples[index] * samples[index];
  }
  return Math.sqrt(squaredTotal / samples.length);
}

/**
 * RMS of `samples` restricted to the speech band via a high-pass +
 * low-pass biquad cascade. Out-of-band rumble (HVAC) and hiss are rejected
 * so the SNR reflects energy the transcription model actually uses.
 */
export function bandpassRms(
  samples: Float32Array,
  sampleRate: number,
  tuning: SnrTuning = SNR_TUNING,
): number {
  if (samples.length === 0 || !(sampleRate > 0)) {
    return 0;
  }
  // Cap the high edge below Nyquist so a 16 kHz canonical clip (Nyquist
  // 8 kHz) keeps a valid filter; a 3.4 kHz edge is always safe here, but
  // guard so the math holds for any sample rate the caller passes.
  const highHz = Math.min(tuning.bandHighHz, sampleRate / 2 - 1);
  const highPassed = applyBiquad(
    samples,
    biquadCoefficients("highpass", tuning.bandLowHz, sampleRate),
  );
  const bandPassed = applyBiquad(
    highPassed,
    biquadCoefficients("lowpass", highHz, sampleRate),
  );
  return rms(bandPassed);
}

/**
 * Band-passed SNR in dB: 20·log10(speechBandRms / noiseBandRms). A zero
 * noise floor (synthetic/silent fixtures) yields a large positive SNR
 * rather than +Infinity by substituting the silence floor.
 */
export function computeSnrDb(
  quietSamples: Float32Array,
  speechSamples: Float32Array,
  sampleRate: number,
  tuning: SnrTuning = SNR_TUNING,
): number {
  const noiseBandRms = bandpassRms(quietSamples, sampleRate, tuning);
  const speechBandRms = bandpassRms(speechSamples, sampleRate, tuning);
  return rmsToDbfs(speechBandRms) - rmsToDbfs(noiseBandRms);
}

function clippingSeverity(
  clipping: ClippingResult,
  tuning: ClippingTuning,
): Severity {
  if (clipping.clippedRatio >= tuning.redRatio) {
    return "bad";
  }
  return clipping.events.length > 0 ? "warn" : "ok";
}

function snrSeverity(snrDb: number, tuning: SnrTuning): Severity {
  if (snrDb < tuning.marginalDb) {
    return "bad";
  }
  return snrDb < tuning.goodDb ? "warn" : "ok";
}

function levelSeverity(speechLevelDbfs: number, tuning: LevelTuning): Severity {
  if (speechLevelDbfs <= tuning.redDbfs) {
    return "bad";
  }
  return speechLevelDbfs <= tuning.yellowDbfs ? "warn" : "ok";
}

const SEVERITY_RANK: Record<Severity, number> = { ok: 0, warn: 1, bad: 2 };

/**
 * Runs the full deterministic acoustic analysis and resolves a
 * traffic-light verdict plus the single highest-leverage issue to surface.
 * The verdict is the worst severity across metrics; ties on the primary
 * issue break by WER leverage (clipping > background-noise > low-level).
 */
export function analyzeMicQuality(
  input: {
    quietSamples: Float32Array;
    speechSamples: Float32Array;
    sampleRate: number;
  },
  tuning: {
    clipping?: ClippingTuning;
    snr?: SnrTuning;
    level?: LevelTuning;
  } = {},
): MicQualityAssessment {
  const clippingTuning = tuning.clipping ?? CLIPPING_TUNING;
  const snrTuning = tuning.snr ?? SNR_TUNING;
  const levelTuning = tuning.level ?? LEVEL_TUNING;

  const clipping = detectClipping(input.speechSamples, clippingTuning);
  const snrDb = computeSnrDb(
    input.quietSamples,
    input.speechSamples,
    input.sampleRate,
    snrTuning,
  );
  const metrics: MicQualityMetrics = {
    clipping,
    snrDb,
    noiseFloorDbfs: rmsToDbfs(rms(input.quietSamples)),
    speechLevelDbfs: rmsToDbfs(rms(input.speechSamples)),
  };

  // Impact-ranked: ties on severity resolve to the higher-leverage issue.
  const ranked: Array<{ issue: MicQualityIssue; severity: Severity }> = [
    { issue: "clipping", severity: clippingSeverity(clipping, clippingTuning) },
    { issue: "background-noise", severity: snrSeverity(snrDb, snrTuning) },
    {
      issue: "low-level",
      severity: levelSeverity(metrics.speechLevelDbfs, levelTuning),
    },
  ];

  let worst = ranked[0];
  for (const candidate of ranked) {
    if (SEVERITY_RANK[candidate.severity] > SEVERITY_RANK[worst.severity]) {
      worst = candidate;
    }
  }

  return {
    verdict: SEVERITY_TO_VERDICT[worst.severity],
    primaryIssue: worst.severity === "ok" ? null : worst.issue,
    metrics,
  };
}
