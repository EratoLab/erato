import { describe, expect, it } from "vitest";

import {
  OVER_VOICE_SPEECH_PROBABILITY,
  overVoiceGate,
  overVoiceStep,
  resolveOverVoiceMinSpeechMs,
  spokeOn,
  spokeOnStart,
  spokeOnStep,
  type OverVoiceStep,
} from "./talkOverVoice";

const FRAME_MS = 32;

/** Runs `frames` probabilities through the gate, one Silero frame each. */
const run = (frames: number[], minSpeechMs = 500): OverVoiceStep[] => {
  let gate = overVoiceGate();
  return frames.map((probability) => {
    const step = overVoiceStep(gate, probability, FRAME_MS, minSpeechMs);
    gate = step.gate;
    return step;
  });
};

const repeat = (probability: number, ms: number) =>
  Array.from({ length: Math.ceil(ms / FRAME_MS) }, () => probability);

describe("talking over the voice", () => {
  it("confirms speech once it lasted the minimum, and lowers the voice before", () => {
    const steps = run(repeat(0.95, 544));
    expect(steps[0]).toMatchObject({ lowered: true, confirmed: false });
    expect(steps.findIndex((step) => step.confirmed)).toBe(15);
    expect(steps.at(-1)?.confirmed).toBe(true);
  });

  it("follows the configured minimum", () => {
    expect(run(repeat(0.95, 224), 200).at(-1)?.confirmed).toBe(true);
    expect(run(repeat(0.95, 544), 1000).some((step) => step.confirmed)).toBe(
      false,
    );
  });

  it("does not confirm a sound that ends before the minimum, and restores the voice", () => {
    // A cough or a short "mhm": 300 ms, then quiet.
    const steps = run([...repeat(0.95, 300), ...repeat(0.05, 300)]);
    expect(steps.some((step) => step.confirmed)).toBe(false);
    expect(steps.at(-1)).toMatchObject({ lowered: false, confirmed: false });
  });

  it("does not add up short sounds separated by pauses", () => {
    const sound = [...repeat(0.95, 250), ...repeat(0.05, 200)];
    const steps = run([...sound, ...sound, ...sound]);
    expect(steps.some((step) => step.confirmed)).toBe(false);
  });

  it("keeps a stretch through a dip between syllables", () => {
    const steps = run([
      ...repeat(0.95, 288),
      ...repeat(0.4, 64),
      ...repeat(0.95, 288),
    ]);
    expect(steps.at(-1)?.confirmed).toBe(true);
  });

  it("never reacts to what the detector is unsure of, such as the voice's own echo", () => {
    const steps = run(repeat(OVER_VOICE_SPEECH_PROBABILITY - 0.01, 3000));
    expect(steps.some((step) => step.lowered || step.confirmed)).toBe(false);
  });
});

describe("the minimum speech over the voice", () => {
  it("keeps values the backend accepts and falls back to 300 ms otherwise", () => {
    expect(resolveOverVoiceMinSpeechMs(200)).toBe(200);
    expect(resolveOverVoiceMinSpeechMs(2000)).toBe(2000);
    expect(resolveOverVoiceMinSpeechMs(undefined)).toBe(300);
    // A malformed local override such as "abc" or "500ms" arrives as NaN.
    expect(resolveOverVoiceMinSpeechMs(Number("500ms"))).toBe(300);
    expect(resolveOverVoiceMinSpeechMs(199)).toBe(300);
    expect(resolveOverVoiceMinSpeechMs(5000)).toBe(300);
  });
});

describe("speech going on once the voice paused", () => {
  const after = (frames: number[]) => {
    let state = spokeOnStart();
    for (const probability of frames)
      state = spokeOnStep(state, probability, FRAME_MS);
    return spokeOn(state);
  };
  // 10 frames = 320 ms: the output's delay and the room's ring.
  const skipped = Array<number>(10).fill(0.95);

  it("is the person when they talk on past the voice's own delay", () => {
    expect(after([...skipped, ...Array<number>(7).fill(0.9)])).toBe(true);
  });

  it("is not when only the moments right after the pause held speech", () => {
    // An echo still sounding while the voice stops, then nothing.
    expect(after([...skipped, ...Array<number>(12).fill(0.1)])).toBe(false);
  });

  it("does not count speech after its window", () => {
    expect(
      after([
        ...skipped,
        ...Array<number>(19).fill(0.1),
        ...Array(10).fill(0.9),
      ]),
    ).toBe(false);
  });

  it("skips the output's own delay too", () => {
    let state = spokeOnStart(200);
    // 13 frames: past the fixed skip, still inside the device's delay.
    for (const probability of Array<number>(13).fill(0.95))
      state = spokeOnStep(state, probability, FRAME_MS);
    expect(state.speechMs).toBe(0);
    expect(spokeOnStart(Number.NaN).skipMs).toBe(300);
  });

  it("is not known before the voice paused", () => {
    expect(spokeOn(null)).toBe(false);
  });
});
