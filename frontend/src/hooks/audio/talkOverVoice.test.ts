import { describe, expect, it } from "vitest";

import {
  OVER_VOICE_SPEECH_PROBABILITY,
  overVoiceGate,
  overVoiceStep,
  resolveOverVoiceMinSpeechMs,
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
  it("keeps values the backend accepts and falls back to 500 ms otherwise", () => {
    expect(resolveOverVoiceMinSpeechMs(200)).toBe(200);
    expect(resolveOverVoiceMinSpeechMs(2000)).toBe(2000);
    expect(resolveOverVoiceMinSpeechMs(undefined)).toBe(500);
    // A malformed local override such as "abc" or "500ms" arrives as NaN.
    expect(resolveOverVoiceMinSpeechMs(Number("500ms"))).toBe(500);
    expect(resolveOverVoiceMinSpeechMs(199)).toBe(500);
    expect(resolveOverVoiceMinSpeechMs(5000)).toBe(500);
  });
});
