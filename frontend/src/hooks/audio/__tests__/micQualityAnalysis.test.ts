import { describe, expect, it } from "vitest";

import {
  activeRms,
  analyzeMicQuality,
  bandpassRms,
  computeSnrDb,
  detectClipping,
  rmsToDbfs,
} from "../micQualityAnalysis";
import {
  CLIPPING_TUNING,
  LEVEL_TUNING,
  SILENCE_FLOOR_DBFS,
  SNR_TUNING,
} from "../micQualityTuning";

const SAMPLE_RATE = 16_000;

/** A sine of the given amplitude and frequency; RMS is amplitude/√2. */
function sine(
  amplitude: number,
  frequencyHz: number,
  durationSeconds = 1,
  sampleRate = SAMPLE_RATE,
): Float32Array {
  const length = Math.round(durationSeconds * sampleRate);
  const out = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    out[index] =
      amplitude * Math.sin((2 * Math.PI * frequencyHz * index) / sampleRate);
  }
  return out;
}

/**
 * Bursty speech proxy: alternating voiced / silent 20 ms windows (50% duty),
 * window-aligned so each window is either fully voiced or fully silent.
 */
function burstSpeech(
  amplitude: number,
  sampleRate = SAMPLE_RATE,
  windows = 50,
): Float32Array {
  const windowSize = Math.round(0.02 * sampleRate);
  const out = new Float32Array(windowSize * windows);
  for (let w = 0; w < windows; w += 1) {
    if (w % 2 !== 0) {
      continue; // silent window
    }
    for (let i = 0; i < windowSize; i += 1) {
      const index = w * windowSize + i;
      out[index] =
        amplitude * Math.sin((2 * Math.PI * 1000 * index) / sampleRate);
    }
  }
  return out;
}

/** Deterministic pseudo-noise in [-amplitude, amplitude] (no Math.random). */
function noise(amplitude: number, length: number, seed = 1): Float32Array {
  const out = new Float32Array(length);
  let state = seed >>> 0;
  for (let index = 0; index < length; index += 1) {
    // xorshift32 — deterministic across runs.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    out[index] = ((state / 0xffffffff) * 2 - 1) * amplitude;
  }
  return out;
}

describe("rmsToDbfs", () => {
  it("maps full-scale RMS to ~0 dBFS and silence to the floor", () => {
    expect(rmsToDbfs(1)).toBeCloseTo(0, 5);
    expect(rmsToDbfs(0)).toBe(SILENCE_FLOOR_DBFS);
    // -20 dBFS is a tenth of full scale.
    expect(rmsToDbfs(0.1)).toBeCloseTo(-20, 5);
  });
});

describe("detectClipping", () => {
  it("returns no events for clean audio", () => {
    const result = detectClipping(sine(0.5, 440, 0.1));
    expect(result.events).toHaveLength(0);
    expect(result.clippedRatio).toBe(0);
  });

  it("ignores runs shorter than the consecutive-sample minimum", () => {
    // Two pinned samples (< 3) surrounded by clean audio → no event.
    const samples = new Float32Array([0, 0.99, 0.99, 0, 0]);
    const result = detectClipping(samples);
    expect(result.events).toHaveLength(0);
  });

  it("flags a run of >= minConsecutiveSamples clipped samples", () => {
    const samples = new Float32Array([0, 1, 1, 1, 0, -1, -1, -1, -1, 0]);
    const result = detectClipping(samples);
    expect(result.events).toEqual([
      { startSample: 1, endSample: 4 },
      { startSample: 5, endSample: 9 },
    ]);
    expect(result.clippedSampleCount).toBe(7);
    expect(result.clippedRatio).toBeCloseTo(0.7, 5);
  });

  it("closes a clip run that reaches the end of the buffer", () => {
    const samples = new Float32Array([0, 0, 1, 1, 1]);
    const result = detectClipping(samples);
    expect(result.events).toEqual([{ startSample: 2, endSample: 5 }]);
  });

  it("uses the configured clip level", () => {
    // 0.95 is below the 0.98 default but above a lowered level.
    const samples = new Float32Array([0.95, 0.95, 0.95]);
    expect(detectClipping(samples).events).toHaveLength(0);
    expect(
      detectClipping(samples, { ...CLIPPING_TUNING, clipLevel: 0.9 }).events,
    ).toHaveLength(1);
  });
});

describe("bandpassRms", () => {
  it("passes an in-band tone and rejects out-of-band tones", () => {
    const inBand = bandpassRms(sine(0.5, 1000), SAMPLE_RATE);
    const subBand = bandpassRms(sine(0.5, 60), SAMPLE_RATE);
    const supraBand = bandpassRms(sine(0.5, 7000), SAMPLE_RATE);
    // In-band energy survives; out-of-band is strongly attenuated.
    expect(inBand).toBeGreaterThan(0.3);
    expect(subBand).toBeLessThan(inBand * 0.2);
    expect(supraBand).toBeLessThan(inBand * 0.2);
  });

  it("returns 0 for empty input or invalid sample rate", () => {
    expect(bandpassRms(new Float32Array(0), SAMPLE_RATE)).toBe(0);
    expect(bandpassRms(sine(0.5, 1000), 0)).toBe(0);
  });
});

describe("computeSnrDb", () => {
  it("reports a high SNR for loud speech over a quiet floor", () => {
    const quiet = noise(0.001, SAMPLE_RATE);
    const speech = sine(0.3, 1000);
    expect(computeSnrDb(quiet, speech, SAMPLE_RATE)).toBeGreaterThan(
      SNR_TUNING.goodDb,
    );
  });

  it("reports a low SNR when noise approaches the speech level", () => {
    const quiet = sine(0.2, 1000);
    const speech = sine(0.25, 1000);
    expect(computeSnrDb(quiet, speech, SAMPLE_RATE)).toBeLessThan(
      SNR_TUNING.marginalDb,
    );
  });
});

describe("analyzeMicQuality", () => {
  const quiet = noise(0.0005, SAMPLE_RATE * 0.5, 7);

  it("returns a good verdict with no issue for clean, well-levelled speech", () => {
    const speech = sine(0.3, 1000); // ~-13 dBFS, in band, no clipping
    const result = analyzeMicQuality({
      quietSamples: quiet,
      speechSamples: speech,
      sampleRate: SAMPLE_RATE,
    });
    expect(result.verdict).toBe("good");
    expect(result.primaryIssue).toBeNull();
  });

  it("flags clipping as poor and as the primary issue when severe", () => {
    // A loud sine hard-clipped at +/-1 produces long flat-top runs.
    const speech = sine(2, 1000);
    for (let index = 0; index < speech.length; index += 1) {
      speech[index] = Math.max(-1, Math.min(1, speech[index]));
    }
    const result = analyzeMicQuality({
      quietSamples: quiet,
      speechSamples: speech,
      sampleRate: SAMPLE_RATE,
    });
    expect(result.verdict).toBe("poor");
    expect(result.primaryIssue).toBe("clipping");
    expect(result.metrics.clipping.events.length).toBeGreaterThan(0);
  });

  it("flags background noise when SNR is poor and there is no clipping", () => {
    const noisyQuiet = sine(0.2, 1000, 0.5);
    const speech = sine(0.25, 1000);
    const result = analyzeMicQuality({
      quietSamples: noisyQuiet,
      speechSamples: speech,
      sampleRate: SAMPLE_RATE,
    });
    expect(result.primaryIssue).toBe("background-noise");
    expect(result.verdict).toBe("poor");
  });

  it("flags critically low speech regardless of SNR", () => {
    const speech = sine(0.003, 1000); // ~-53 dBFS, below the critical floor
    const result = analyzeMicQuality({
      quietSamples: quiet,
      speechSamples: speech,
      sampleRate: SAMPLE_RATE,
    });
    expect(result.primaryIssue).toBe("low-level");
    expect(result.metrics.speechLevelDbfs).toBeLessThan(
      LEVEL_TUNING.criticallyLowDbfs,
    );
  });

  it("does not flag a quiet-but-clean capture (high SNR) as low level", () => {
    // ~-35 dBFS speech in a quiet room — the Safari/AGC-off case. The old
    // absolute-dBFS gate would warn; with SNR gating it grades good.
    const speech = sine(0.025, 1000);
    const result = analyzeMicQuality({
      quietSamples: quiet,
      speechSamples: speech,
      sampleRate: SAMPLE_RATE,
    });
    // Genuinely quiet (would have tripped the old yellow threshold)…
    expect(result.metrics.speechLevelDbfs).toBeLessThan(
      LEVEL_TUNING.yellowDbfs,
    );
    expect(result.metrics.speechLevelDbfs).toBeGreaterThan(
      LEVEL_TUNING.criticallyLowDbfs,
    );
    // …but clean (strong SNR), so it isn't blamed on the mic.
    expect(result.metrics.snrDb).toBeGreaterThan(SNR_TUNING.goodDb);
    expect(result.primaryIssue).not.toBe("low-level");
    expect(result.verdict).toBe("good");
  });

  it("does not flag low level when speech has silent gaps but voiced bursts are healthy", () => {
    // 50% duty: alternating voiced/silent 20 ms windows. Whole-window RMS is
    // dragged below the warn threshold by the silence; the active level (what
    // we now measure) reflects the voiced bursts and stays usable.
    const speech = burstSpeech(0.06);
    let squaredTotal = 0;
    for (let i = 0; i < speech.length; i += 1) squaredTotal += speech[i] ** 2;
    const wholeWindowDbfs = rmsToDbfs(Math.sqrt(squaredTotal / speech.length));

    const result = analyzeMicQuality({
      quietSamples: quiet,
      speechSamples: speech,
      sampleRate: SAMPLE_RATE,
    });

    // The old whole-window measure would have warned…
    expect(wholeWindowDbfs).toBeLessThan(LEVEL_TUNING.yellowDbfs);
    // …but the active level does not, so the mic isn't wrongly blamed.
    expect(result.metrics.speechLevelDbfs).toBeGreaterThan(
      LEVEL_TUNING.yellowDbfs,
    );
    expect(result.primaryIssue).not.toBe("low-level");
  });
});

describe("activeRms", () => {
  it("matches whole-window RMS for a continuous tone", () => {
    const tone = sine(0.2, 1000);
    expect(activeRms(tone, SAMPLE_RATE)).toBeCloseTo(0.2 / Math.SQRT2, 2);
  });

  it("ignores silent gaps, reporting the voiced level for bursty speech", () => {
    const burst = burstSpeech(0.06);
    let squaredTotal = 0;
    for (let i = 0; i < burst.length; i += 1) squaredTotal += burst[i] ** 2;
    const wholeRms = Math.sqrt(squaredTotal / burst.length);
    const active = activeRms(burst, SAMPLE_RATE);
    // Active reflects the voiced bursts (~amp/√2); whole-window is diluted.
    expect(active).toBeCloseTo(0.06 / Math.SQRT2, 2);
    expect(active).toBeGreaterThan(wholeRms * 1.2);
  });

  it("returns 0 for empty input or invalid sample rate", () => {
    expect(activeRms(new Float32Array(0), SAMPLE_RATE)).toBe(0);
    expect(activeRms(sine(0.2, 1000), 0)).toBe(0);
  });
});
