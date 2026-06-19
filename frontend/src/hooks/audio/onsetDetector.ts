/**
 * Pure speech-onset state machine (ERMAIN-379). Replaces the exact-zero
 * predicate (`sample !== 0`) that gated the UI "speak now" cue
 * (`isCapturingAudio`). Exact-zero detection assumes silence == digital
 * zero — true on Chromium's capture pipeline, but FALSE on WebKit/Safari
 * raw capture, which emits a low-level noise floor / DC bias at stream
 * start, so the old cue tripped ~1 s before real speech.
 *
 * The machine runs in three phases:
 *   1. calibrate — measure the noise-floor RMS over the first
 *      `calibrationMs` of real incoming audio, then derive an adaptive
 *      `epsilon` threshold above it.
 *   2. listen — flip onset after `consecutiveSubWindowsToFlip` sub-windows
 *      whose DC-removed RMS clears `epsilon`.
 *   3. max-hold — if neither happens (a near-silent input an RMS gate can
 *      never trip), force the flip after `maxHoldMs` so the spinner can
 *      never hang.
 *
 * No DOM, no React, no `Date.now()` — time is derived from the running
 * sample count, so the detector is fully deterministic and unit-testable
 * against recorded warm-up vs speech fixtures. It gates ONLY the UI cue;
 * it never sees or alters the bytes streamed to the server.
 */

import { removeDcAndRms } from "./audio-pcm-codec";
import { ONSET_TUNING, type OnsetTuning } from "./audioTuning";

export type OnsetPhase = "calibrating" | "listening" | "fired";

export type OnsetFrameOutcome = {
  /** Detector phase after consuming this frame. */
  phase: OnsetPhase;
  /** True on exactly the one frame whose processing triggers the onset. */
  onset: boolean;
  /** Highest sub-window RMS observed in this frame (diagnostics only). */
  frameRms: number;
  /** Chosen threshold once calibration completes; `null` while calibrating. */
  epsilon: number | null;
};

export type OnsetDetector = {
  /**
   * Feed one received PCM frame (Float32, any length). Returns the
   * detector state after consuming it; `onset` is true on exactly one
   * call. Cheap to keep calling after onset (returns immediately).
   */
  accept: (frame: Float32Array) => OnsetFrameOutcome;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function createOnsetDetector(options: {
  sampleRate: number;
  tuning?: OnsetTuning;
}): OnsetDetector {
  const tuning = options.tuning ?? ONSET_TUNING;
  const sampleRate = options.sampleRate > 0 ? options.sampleRate : 1;
  const subWindowSamples = Math.max(1, tuning.subWindowSamples);

  // Holds samples that didn't fill a complete sub-window on the previous
  // frame, so sub-windowing is robust to any frame length / boundary.
  const pending = new Float32Array(subWindowSamples);
  let pendingCount = 0;

  // Time is measured by sub-windows actually evaluated, NOT by raw frame
  // length. A received frame is 4096 samples = 256 ms at a 16 k track, so
  // crediting a whole frame before evaluating its first sub-window would
  // push `elapsedMs()` past `calibrationMs` (200 ms) before a single
  // calibration sample is taken — the adaptive floor would never run and
  // every onset would fall back to the fixed epsilon. Counting per
  // sub-window keeps calibration live at every track rate.
  let samplesProcessed = 0;
  let phase: OnsetPhase = "calibrating";
  let epsilon: number | null = null;

  let floorSum = 0;
  let floorCount = 0;
  let consecutiveOverThreshold = 0;
  // Highest sub-window RMS seen within the frame currently being consumed.
  let lastRms = 0;

  const elapsedMs = () => (samplesProcessed / sampleRate) * 1000;

  const finalizeCalibration = () => {
    epsilon =
      floorCount > 0
        ? clamp(
            (floorSum / floorCount) * tuning.floorMultiplier,
            tuning.epsilonMin,
            tuning.epsilonMax,
          )
        : tuning.fixedFallbackEpsilon;
    phase = "listening";
  };

  // Processes one complete sub-window; returns true if it triggers onset.
  const processSubWindow = (subWindow: Float32Array): boolean => {
    // Credit this sub-window's audio to the clock as it is evaluated, so
    // calibration / max-hold thresholds advance at sub-window granularity.
    samplesProcessed += subWindowSamples;

    const rms = removeDcAndRms(subWindow);
    // Guard against a non-finite sample poisoning the running floor sum (and
    // thus epsilon) for the rest of the session: skip the sub-window but
    // still let the clock advance so max-hold can fire. Web Audio capture
    // floats are spec'd finite, so this is belt-and-braces.
    if (!Number.isFinite(rms)) {
      return elapsedMs() >= tuning.maxHoldMs
        ? ((phase = "fired"), true)
        : false;
    }
    lastRms = Math.max(lastRms, rms);

    if (phase === "calibrating") {
      if (elapsedMs() < tuning.calibrationMs) {
        floorSum += rms;
        floorCount += 1;
        return false;
      }
      // Calibration window elapsed — derive epsilon and evaluate this
      // same sub-window against it rather than discarding it.
      finalizeCalibration();
    }

    if (phase === "listening" && epsilon !== null) {
      if (rms >= epsilon) {
        consecutiveOverThreshold += 1;
        if (consecutiveOverThreshold >= tuning.consecutiveSubWindowsToFlip) {
          phase = "fired";
          return true;
        }
      } else {
        consecutiveOverThreshold = 0;
      }
    }

    // Max-hold: an RMS gate can never trip on near-silent input, so force
    // the flip regardless once enough audio has flowed.
    if (elapsedMs() >= tuning.maxHoldMs) {
      phase = "fired";
      return true;
    }

    return false;
  };

  return {
    accept(frame: Float32Array): OnsetFrameOutcome {
      lastRms = 0;
      if (phase === "fired") {
        return { phase, onset: false, frameRms: 0, epsilon };
      }

      let onset = false;

      let sourceIndex = 0;
      while (sourceIndex < frame.length) {
        const copyCount = Math.min(
          subWindowSamples - pendingCount,
          frame.length - sourceIndex,
        );
        pending.set(
          frame.subarray(sourceIndex, sourceIndex + copyCount),
          pendingCount,
        );
        pendingCount += copyCount;
        sourceIndex += copyCount;

        if (pendingCount === subWindowSamples) {
          // `processSubWindow` flips at most once; keep draining the rest
          // of the frame into `pending` but stop evaluating after onset.
          if (!onset && processSubWindow(pending)) {
            onset = true;
          }
          pendingCount = 0;
        }
      }

      return { phase, onset, frameRms: lastRms, epsilon };
    },
  };
}
