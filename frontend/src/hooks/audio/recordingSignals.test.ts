import { describe, expect, it } from "vitest";

import { audioFrom, recordingSignals, withFrame } from "./recordingSignals";

describe("what the detector heard in a recording", () => {
  it("counts speech by sample time from the start, and the first speech once", () => {
    let signals = recordingSignals(1_000, false);
    for (const probability of [0.1, 0.2, 0.9, 0.4, 0.8])
      signals = withFrame(signals, 32, probability);
    expect(signals).toEqual({
      startedAt: 1_000,
      endedAt: 1_160,
      firstSpeechAt: 1_064,
      speechMs: 64,
      recordedMs: 160,
      overVoice: false,
      audioAt: 1_000,
    });
  });

  it("times frames from the microphone's first sample, behind the silence heard first", () => {
    // Asked for at 1 000; the first sample came at 1 400, the detector hears
    // 300 ms of silence before it: speech in its 11th frame was said at 1 420.
    let signals = audioFrom(recordingSignals(1_000, false), 1_400, 300);
    for (let frame = 0; frame < 10; frame += 1)
      signals = withFrame(signals, 32, 0);
    signals = withFrame(signals, 32, 0.9);
    expect(signals.startedAt).toBe(1_000);
    expect(signals.firstSpeechAt).toBe(1_420);
    expect(signals.endedAt).toBe(1_452);
  });

  it("a silent recording has no first speech", () => {
    const signals = withFrame(recordingSignals(0, true), 32, 0.3);
    expect(signals.firstSpeechAt).toBeNull();
    expect(signals.overVoice).toBe(true);
  });
});
