import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The worklet runs in AudioWorkletGlobalScope, which declares
// `AudioWorkletProcessor` and `registerProcessor` as ambient globals. Shim
// them so the module can be imported and exercised in a plain test
// environment, capturing the registered processor class and every frame it
// posts. This tests the SHIPPED worklet code directly — no refactor.
const FRAME_SIZE = 4096;

let ProcessorClass: any;
let posted: Float32Array[] = [];

beforeAll(async () => {
  class FakeAudioWorkletProcessor {
    port = {
      postMessage: (data: Float32Array) => {
        posted.push(data);
      },
    };
  }
  vi.stubGlobal("AudioWorkletProcessor", FakeAudioWorkletProcessor);
  vi.stubGlobal("registerProcessor", (_name: string, cls: any) => {
    ProcessorClass = cls;
  });
  // The worklet is a self-contained AudioWorklet script with no top-level
  // export (it can't import anything — it runs in AudioWorkletGlobalScope),
  // so TS treats it as a non-module. The runtime import works fine here.
  // @ts-expect-error -- audio-dictation-worklet.ts is a classic script, not a module
  await import("../audio-dictation-worklet");
});

beforeEach(() => {
  posted = [];
});

function filled(value: number, length = FRAME_SIZE) {
  return new Float32Array(length).fill(value);
}

describe("audio-dictation-worklet down-mix", () => {
  it("passes a single channel through unchanged (mono fast path)", () => {
    const processor = new ProcessorClass();
    const mono = new Float32Array(FRAME_SIZE);
    for (let i = 0; i < FRAME_SIZE; i += 1) mono[i] = (i % 200) / 200;

    const keepGoing = processor.process([[mono]]);

    expect(keepGoing).toBe(true);
    expect(posted).toHaveLength(1);
    expect(Array.from(posted[0])).toEqual(Array.from(mono));
  });

  it("averages stereo channels (Safari raw-capture case)", () => {
    const processor = new ProcessorClass();

    processor.process([[filled(1), filled(0)]]);

    expect(posted).toHaveLength(1);
    expect(posted[0].every((sample) => sample === 0.5)).toBe(true);
  });

  it("guards ragged channels using each channel's own length", () => {
    const processor = new ProcessorClass();
    const left = filled(1, FRAME_SIZE);
    const right = filled(0, FRAME_SIZE / 2); // short channel

    processor.process([[left, right]]);

    expect(posted).toHaveLength(1);
    // Where both channels exist: mean of 1 and 0 = 0.5.
    expect(posted[0][0]).toBe(0.5);
    // Past the short channel's end: only the long channel contributes = 1.
    expect(posted[0][FRAME_SIZE - 1]).toBe(1);
  });

  it("emits nothing when there is no audio (empty / missing channels)", () => {
    const processor = new ProcessorClass();

    expect(processor.process([[new Float32Array(0)]])).toBe(true);
    expect(processor.process([[]])).toBe(true);
    expect(processor.process([])).toBe(true);
    expect(posted).toHaveLength(0);
  });
});
