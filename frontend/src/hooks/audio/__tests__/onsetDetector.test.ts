import { describe, expect, it } from "vitest";

import { removeDcAndRms } from "../audio-pcm-codec";
import { ONSET_TUNING } from "../audioTuning";
import { createOnsetDetector } from "../onsetDetector";

const SAMPLE_RATE = 48_000;
const FRAME_SIZE = 4096;

/** A constant-amplitude sine frame; RMS of a sine of amplitude a is a/√2. */
function sineFrame(amplitude: number, dcBias = 0, length = FRAME_SIZE) {
  const frame = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    frame[index] =
      dcBias + amplitude * Math.sin((2 * Math.PI * 440 * index) / SAMPLE_RATE);
  }
  return frame;
}

function zeroFrame(length = FRAME_SIZE) {
  return new Float32Array(length);
}

describe("removeDcAndRms", () => {
  it("returns 0 for an empty or all-zero window", () => {
    expect(removeDcAndRms(new Float32Array(0))).toBe(0);
    expect(removeDcAndRms(new Float32Array(512))).toBe(0);
  });

  it("removes DC bias so a constant offset reads as zero energy", () => {
    const constant = new Float32Array(512).fill(0.4);
    expect(removeDcAndRms(constant)).toBeCloseTo(0, 6);
  });

  it("measures sine RMS as amplitude/√2 regardless of DC offset", () => {
    const amplitude = 0.2;
    const expected = amplitude / Math.SQRT2;
    expect(removeDcAndRms(sineFrame(amplitude, 0, 4800))).toBeCloseTo(
      expected,
      2,
    );
    // DC bias must not change the result.
    expect(removeDcAndRms(sineFrame(amplitude, 0.5, 4800))).toBeCloseTo(
      expected,
      2,
    );
  });
});

describe("createOnsetDetector", () => {
  it("does not fire on Chrome-style exact-zero warm-up, then fires on speech", () => {
    const detector = createOnsetDetector({ sampleRate: SAMPLE_RATE });

    // ~256 ms of bit-exact zeros (Chrome cold warm-up) — covers calibration.
    for (let frame = 0; frame < 3; frame += 1) {
      expect(detector.accept(zeroFrame()).onset).toBe(false);
    }

    // Real speech arrives — onset should flip within a couple of frames.
    let fired = false;
    for (let frame = 0; frame < 3 && !fired; frame += 1) {
      fired = detector.accept(sineFrame(0.1)).onset;
    }
    expect(fired).toBe(true);
  });

  it("calibrates above a WebKit-style noise floor and only fires on speech", () => {
    const detector = createOnsetDetector({ sampleRate: SAMPLE_RATE });

    // WebKit warm-up: low-level noise floor + DC bias, NOT exact zeros.
    // The old `!== 0` predicate fired here; the RMS gate must not.
    for (let frame = 0; frame < 4; frame += 1) {
      expect(detector.accept(sineFrame(0.003, 0.0015)).onset).toBe(false);
    }

    // Louder speech clears the calibrated threshold.
    let fired = false;
    for (let frame = 0; frame < 3 && !fired; frame += 1) {
      fired = detector.accept(sineFrame(0.1)).onset;
    }
    expect(fired).toBe(true);
  });

  it("clamps epsilon into [epsilonMin, epsilonMax]", () => {
    // Very loud 'floor' → epsilon would exceed the max → clamped down.
    const loud = createOnsetDetector({ sampleRate: SAMPLE_RATE });
    let loudEpsilon: number | null = null;
    for (let frame = 0; frame < 4 && loudEpsilon === null; frame += 1) {
      loudEpsilon = loud.accept(sineFrame(0.5)).epsilon;
    }
    expect(loudEpsilon).toBe(ONSET_TUNING.epsilonMax);

    // Silent floor → epsilon would be 0 → clamped up to the min.
    const quiet = createOnsetDetector({ sampleRate: SAMPLE_RATE });
    let quietEpsilon: number | null = null;
    for (let frame = 0; frame < 4 && quietEpsilon === null; frame += 1) {
      quietEpsilon = quiet.accept(zeroFrame()).epsilon;
    }
    expect(quietEpsilon).toBe(ONSET_TUNING.epsilonMin);
  });

  it("force-flips via max-hold when the input is near-silent forever", () => {
    const detector = createOnsetDetector({ sampleRate: SAMPLE_RATE });

    // Always below threshold: an RMS gate can never trip here, so without
    // max-hold the spinner would hang. It must flip once enough audio has
    // flowed (~maxHoldMs).
    const maxHoldFrames = Math.ceil(
      ((ONSET_TUNING.maxHoldMs / 1000) * SAMPLE_RATE) / FRAME_SIZE,
    );
    let firedFrame = -1;
    for (let frame = 0; frame < maxHoldFrames + 3; frame += 1) {
      if (detector.accept(sineFrame(0.001)).onset) {
        firedFrame = frame;
        break;
      }
    }
    expect(firedFrame).toBeGreaterThanOrEqual(maxHoldFrames - 1);
    expect(firedFrame).toBeLessThanOrEqual(maxHoldFrames + 1);
  });

  it("runs the adaptive floor path at a true 16 kHz track rate (regression)", () => {
    // At 16 kHz one 4096-sample frame is 256 ms — longer than the 200 ms
    // calibration window. Crediting time per frame would skip calibration
    // entirely and fall back to the fixed epsilon; per-sub-window timing
    // must keep the adaptive clamp(floor × 2.75) path live. The floor here
    // is chosen so the adaptive epsilon lands strictly inside the clamp
    // band and is distinct from the fixed fallback.
    for (const rate of [16_000, 48_000]) {
      const detector = createOnsetDetector({ sampleRate: rate });
      const amplitude = 0.004 * Math.SQRT2; // RMS ≈ 0.004 → epsilon ≈ 0.011
      let epsilon: number | null = null;
      for (let frame = 0; frame < 8 && epsilon === null; frame += 1) {
        epsilon = detector.accept(sineFrame(amplitude, 0, FRAME_SIZE)).epsilon;
      }
      expect(epsilon).not.toBeNull();
      expect(epsilon).not.toBe(ONSET_TUNING.fixedFallbackEpsilon);
      expect(epsilon).toBeGreaterThan(ONSET_TUNING.epsilonMin);
      expect(epsilon).toBeLessThan(ONSET_TUNING.epsilonMax);
    }
  });

  it("survives non-finite samples without wedging epsilon (max-hold still fires)", () => {
    const detector = createOnsetDetector({ sampleRate: SAMPLE_RATE });
    const poison = new Float32Array(FRAME_SIZE).fill(Number.NaN);
    let fired = false;
    for (let frame = 0; frame < 12 && !fired; frame += 1) {
      fired = detector.accept(poison).onset;
    }
    // A NaN stream can never cross a threshold, but max-hold must still flip.
    expect(fired).toBe(true);
  });

  it("reports onset exactly once", () => {
    const detector = createOnsetDetector({ sampleRate: SAMPLE_RATE });
    for (let frame = 0; frame < 3; frame += 1) {
      detector.accept(zeroFrame());
    }
    let onsetCount = 0;
    for (let frame = 0; frame < 10; frame += 1) {
      if (detector.accept(sineFrame(0.1)).onset) {
        onsetCount += 1;
      }
    }
    expect(onsetCount).toBe(1);
  });

  it("sub-windows correctly across ragged frame lengths", () => {
    // Feeding odd-length frames must not desync the sub-window boundaries.
    const detector = createOnsetDetector({ sampleRate: SAMPLE_RATE });
    for (let frame = 0; frame < 6; frame += 1) {
      detector.accept(zeroFrame(777));
    }
    let fired = false;
    for (let frame = 0; frame < 20 && !fired; frame += 1) {
      fired = detector.accept(sineFrame(0.1, 0, 777)).onset;
    }
    expect(fired).toBe(true);
  });
});
