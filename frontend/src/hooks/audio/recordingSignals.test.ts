import { describe, expect, it } from "vitest";

import { recordingSignals, withFrame } from "./recordingSignals";

const frames = (
  start: ReturnType<typeof recordingSignals>,
  probabilities: number[],
) =>
  probabilities.reduce(
    (signals, probability) => withFrame(signals, 32, probability),
    start,
  );

describe("what the detector heard in a recording", () => {
  it("counts speech by sample time from the start, and the first speech once", () => {
    expect(
      frames(recordingSignals(1_000, false), [0.1, 0.2, 0.9, 0.4, 0.8]),
    ).toEqual({
      startedAt: 1_000,
      endedAt: 1_160,
      firstSpeechAt: 1_064,
      speechMs: 64,
      recordedMs: 160,
      overVoice: false,
      leadInMs: 0,
      judgedMs: 160,
    });
  });

  it("a silent recording has no first speech", () => {
    const signals = withFrame(recordingSignals(0, true), 32, 0.3);
    expect(signals.firstSpeechAt).toBeNull();
    expect(signals.overVoice).toBe(true);
  });

  it("the lead-in of silence before the microphone moves no time", () => {
    const silence = Array.from({ length: 9 }, () => 0);
    const atOnce = frames(recordingSignals(1_000, false, 300), [
      ...silence,
      0.9,
    ]);
    expect(atOnce.firstSpeechAt).toBe(1_000);
    expect(atOnce.recordedMs).toBe(20);
    const later = frames(recordingSignals(1_000, false, 300), [
      ...silence,
      0,
      0,
      0,
      0.9,
    ]);
    expect(later.firstSpeechAt).toBe(1_000 + 384 - 300);
    expect(later.endedAt).toBe(1_000 + 416 - 300);
  });
});
