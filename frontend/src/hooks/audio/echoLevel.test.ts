import { describe, expect, it } from "vitest";

import {
  echoCoupling,
  forgetLeadIn,
  noteEchoFrame,
  type EchoCoupling,
} from "./echoLevel";
import { overVoiceGate, overVoiceStep } from "./talkOverVoice";

const FRAME_MS = 32;

/** A voice's level that rises and falls like speech, frame by frame. */
const voiceAt = (frame: number) =>
  0.05 + 0.15 * Math.abs(Math.sin(frame / 3)) * (frame % 11 < 8 ? 1 : 0.2);

/** Runs frames through the echo check and the gate, as the recorder does. */
function run(
  frames: number,
  heardAt: (frame: number, played: number) => number,
  start: EchoCoupling = echoCoupling(),
  playedAt: (frame: number) => number = voiceAt,
) {
  let coupling = start;
  let gate = overVoiceGate();
  let counted = 0;
  let confirmed = false;
  for (let frame = 0; frame < frames; frame += 1) {
    const played = playedAt(frame);
    const heard = heardAt(frame, played);
    const echo = noteEchoFrame(coupling, {
      heard,
      played,
      frameMs: FRAME_MS,
      inStretch: gate.speechMs > 0,
    });
    coupling = echo.coupling;
    if (echo.overEcho) counted += 1;
    // The detector hears speech in anything above the room's own sound.
    const speech = heard > 0.002 ? 0.95 : 0.05;
    const step = overVoiceStep(gate, echo.overEcho ? speech : 0, FRAME_MS, 300);
    gate = step.gate;
    if (step.confirmed) coupling = forgetLeadIn(coupling);
    confirmed ||= step.confirmed;
  }
  return { coupling, counted, confirmed };
}

/** A small, repeatable wobble: speakers and rooms colour the echo. */
const wobble = (frame: number) => 0.6 + 0.8 * (((frame * 7919) % 101) / 100);

describe("noteEchoFrame", () => {
  it.each([0.003, 0.03, 0.3, 1])(
    "never lets the voice's echo alone through the gate, at strength %s",
    (strength) => {
      const result = run(
        400,
        (frame, played) => strength * played * wobble(frame),
      );
      expect(result.confirmed).toBe(false);
    },
  );

  it("lets the user through over a strong echo", () => {
    const { coupling } = run(
      200,
      (frame, played) => 0.3 * played * wobble(frame),
    );
    const person = run(
      20,
      (frame, played) => 0.3 * played * wobble(frame) + 0.12,
      coupling,
    );
    expect(person.confirmed).toBe(true);
  });

  it("lets a quiet user through when nothing comes back (headphones)", () => {
    const { coupling } = run(200, () => 0.0005);
    expect(run(20, () => 0.01, coupling).confirmed).toBe(true);
  });

  it("lets the user through over room sound while the voice has quiet passages", () => {
    const room = (frame: number) =>
      0.0008 + 0.0004 * (((frame * 7919) % 101) / 100);
    const quietVoice = (frame: number) =>
      frame % 7 < 2 ? 0.002 : voiceAt(frame);
    let coupling = echoCoupling();
    for (let frame = 0; frame < 200; frame += 1)
      coupling = noteEchoFrame(coupling, {
        heard: room(frame),
        played: quietVoice(frame),
        frameMs: FRAME_MS,
        inStretch: false,
      }).coupling;
    expect(run(20, (frame) => room(frame) + 0.02, coupling).confirmed).toBe(
      true,
    );
  });

  it("counts nothing before it has measured the echo", () => {
    expect(run(9, () => 0.5).counted).toBe(0);
  });

  it("counts every frame while the voice is silent: nothing can come back", () => {
    const echo = noteEchoFrame(echoCoupling(), {
      heard: 0.01,
      played: 0,
      frameMs: FRAME_MS,
      inStretch: false,
    });
    expect(echo.overEcho).toBe(true);
  });

  it("learns the echo from frames outside a stretch only: a user talking back does not raise the bar", () => {
    const { coupling } = run(
      200,
      (frame, played) => 0.05 * played * wobble(frame),
    );
    let state = coupling;
    for (let frame = 0; frame < 200; frame += 1)
      state = noteEchoFrame(state, {
        heard: 0.2,
        played: voiceAt(frame),
        frameMs: FRAME_MS,
        inStretch: true,
      }).coupling;
    state = forgetLeadIn(state);
    expect(state.learned).toEqual(coupling.learned);
    expect(state.pending).toEqual([]);
  });

  it("does not take an echo that comes back late (Bluetooth) for the user when the voice starts", () => {
    // The loudest of the last 600 ms, as the recorder asks for it.
    const windowMax = (frame: number) =>
      frame < 0
        ? 0
        : Math.max(
            ...Array.from({ length: 20 }, (_, back) =>
              frame - back >= 0 ? voiceAt(frame - back) : 0,
            ),
          );
    // Silence, then the voice; its echo arrives 200 ms (6 frames) later.
    const result = run(
      400,
      (frame) =>
        0.0008 + (frame >= 30 ? 0.25 * voiceAt(frame - 6) * wobble(frame) : 0),
      echoCoupling(),
      (frame) => (frame < 24 ? 0 : windowMax(frame - 24)),
    );
    expect(result.confirmed).toBe(false);
  });
});
