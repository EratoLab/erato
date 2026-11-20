import { describe, expect, it } from "vitest";

import { recordingSignals, withFrame } from "./recordingSignals";

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
    });
  });

  it("a silent recording has no first speech", () => {
    const signals = withFrame(recordingSignals(0, true), 32, 0.3);
    expect(signals.firstSpeechAt).toBeNull();
    expect(signals.overVoice).toBe(true);
  });
});
