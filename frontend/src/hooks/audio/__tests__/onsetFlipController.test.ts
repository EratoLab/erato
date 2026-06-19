import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MIN_AUDIO_CAPTURE_DELAY_MS, ONSET_TUNING } from "../audioTuning";
import { createSpeechOnsetController } from "../onsetFlipController";

const SAMPLE_RATE = 48_000;
const FRAME_SIZE = 4096;

function zeroFrame() {
  return new Float32Array(FRAME_SIZE);
}

function loudFrame() {
  const frame = new Float32Array(FRAME_SIZE);
  for (let i = 0; i < FRAME_SIZE; i += 1) {
    frame[i] = 0.1 * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE);
  }
  return frame;
}

/** Feeds calibration zeros + a loud frame; onset fires within the loud one. */
function driveToOnset(controller: { acceptFrame: (f: Float32Array) => void }) {
  controller.acceptFrame(zeroFrame());
  controller.acceptFrame(zeroFrame());
  controller.acceptFrame(zeroFrame());
  controller.acceptFrame(loudFrame());
}

describe("createSpeechOnsetController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("force-flips via the wall-clock backstop when no frames ever arrive (G1)", () => {
    const onFlip = vi.fn();
    createSpeechOnsetController({ sampleRate: SAMPLE_RATE, onFlip });

    // No frames at all — the audio-time max-hold can never advance.
    expect(onFlip).not.toHaveBeenCalled();
    vi.advanceTimersByTime(ONSET_TUNING.wallClockBackstopMs);
    expect(onFlip).toHaveBeenCalledTimes(1);
  });

  it("dispose cancels the pending backstop (no flip after teardown)", () => {
    const onFlip = vi.fn();
    const controller = createSpeechOnsetController({
      sampleRate: SAMPLE_RATE,
      onFlip,
    });

    controller.dispose();
    vi.advanceTimersByTime(ONSET_TUNING.wallClockBackstopMs * 2);
    expect(onFlip).not.toHaveBeenCalled();
  });

  it("flips once on real onset after the deferral, and cancels the backstop", () => {
    const onFlip = vi.fn();
    const controller = createSpeechOnsetController({
      sampleRate: SAMPLE_RATE,
      onFlip,
    });

    driveToOnset(controller);
    // Onset reached, but the cue is deferred by the min-capture-delay floor.
    expect(onFlip).not.toHaveBeenCalled();

    vi.advanceTimersByTime(MIN_AUDIO_CAPTURE_DELAY_MS);
    expect(onFlip).toHaveBeenCalledTimes(1);

    // Backstop must have been cancelled by the real onset — no second flip.
    vi.advanceTimersByTime(ONSET_TUNING.wallClockBackstopMs);
    expect(onFlip).toHaveBeenCalledTimes(1);
  });

  it("ignores frames after onset (fire-once)", () => {
    const onFlip = vi.fn();
    const controller = createSpeechOnsetController({
      sampleRate: SAMPLE_RATE,
      onFlip,
    });

    driveToOnset(controller);
    vi.advanceTimersByTime(MIN_AUDIO_CAPTURE_DELAY_MS);
    expect(onFlip).toHaveBeenCalledTimes(1);

    controller.acceptFrame(loudFrame());
    controller.acceptFrame(loudFrame());
    vi.advanceTimersByTime(MIN_AUDIO_CAPTURE_DELAY_MS);
    expect(onFlip).toHaveBeenCalledTimes(1);
  });

  it("invokes the diagnostics sink per frame until onset, then stops", () => {
    const log = vi.fn();
    const controller = createSpeechOnsetController({
      sampleRate: SAMPLE_RATE,
      onFlip: vi.fn(),
      log,
    });

    // 3 calibration zeros + 1 loud frame that triggers onset = 4 evaluations.
    driveToOnset(controller);
    expect(log).toHaveBeenCalledTimes(4);
    const sample = log.mock.calls[0][0];
    expect(sample).toHaveProperty("rms");
    expect(sample).toHaveProperty("epsilon");
    expect(sample).toHaveProperty("phase");

    // Post-onset frames are short-circuited before the detector / sink run.
    controller.acceptFrame(loudFrame());
    expect(log).toHaveBeenCalledTimes(4);
  });
});
