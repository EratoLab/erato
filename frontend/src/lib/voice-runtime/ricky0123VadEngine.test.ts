import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createRicky0123VadEngine,
  Ricky0123VadEngine,
} from "./ricky0123VadEngine";

import type { VoiceVadEvent } from "./vadEngine";

const vadMock = vi.hoisted(() => {
  const fakeVad = {
    processFrame: vi.fn(async (_frame: Float32Array) => {}),
    frameProcessor: {
      resume: vi.fn(),
      reset: vi.fn(),
    },
    model: {
      reset_state: vi.fn(),
      release: vi.fn(async () => {}),
    },
  };
  const state: {
    options: Record<string, unknown> | null;
  } = {
    options: null,
  };
  const newMock = vi.fn(async (options: Record<string, unknown>) => {
    state.options = options;
    return fakeVad;
  });

  return {
    fakeVad,
    newMock,
    state,
  };
});

vi.mock("@ricky0123/vad-web", () => ({
  MicVAD: {
    new: vadMock.newMock,
  },
}));

beforeEach(() => {
  vadMock.state.options = null;
  vadMock.newMock.mockClear();
  vadMock.fakeVad.processFrame.mockReset();
  vadMock.fakeVad.processFrame.mockImplementation(
    async (_frame: Float32Array) => {},
  );
  vadMock.fakeVad.frameProcessor.resume.mockClear();
  vadMock.fakeVad.frameProcessor.reset.mockClear();
  vadMock.fakeVad.model.reset_state.mockClear();
  vadMock.fakeVad.model.release.mockClear();
});

describe("Ricky0123VadEngine", () => {
  it("loads MicVAD with our runtime assets and V5 model by default", async () => {
    const engine = createRicky0123VadEngine({
      assets: "/public/common/voice-runtime",
      positiveSpeechThreshold: 0.65,
      negativeSpeechThreshold: 0.4,
      redemptionMs: 800,
      preSpeechPadMs: 120,
      minSpeechMs: 240,
    });

    await engine.start();

    expect(vadMock.newMock).toHaveBeenCalledTimes(1);
    expect(vadMock.fakeVad.frameProcessor.resume).toHaveBeenCalledTimes(1);
    expect(vadMock.state.options).toEqual(
      expect.objectContaining({
        baseAssetPath: "/public/common/voice-runtime/ricky0123-vad-web/",
        onnxWASMBasePath: "/public/common/voice-runtime/onnxruntime-web/",
        model: "v5",
        startOnLoad: false,
        positiveSpeechThreshold: 0.65,
        negativeSpeechThreshold: 0.4,
        redemptionMs: 800,
        preSpeechPadMs: 120,
        minSpeechMs: 240,
      }),
    );
  });

  it("maps the legacy model option", async () => {
    const engine = new Ricky0123VadEngine({
      model: "silero-legacy",
      assetOptions: {
        baseAssetPath: "/vad/",
        onnxWASMBasePath: "/ort/",
      },
    });

    await engine.start();

    expect(vadMock.state.options).toEqual(
      expect.objectContaining({
        baseAssetPath: "/vad/",
        onnxWASMBasePath: "/ort/",
        model: "legacy",
      }),
    );
  });

  it("omits undefined tuning options so Ricky's defaults remain active", async () => {
    const engine = createRicky0123VadEngine({
      assetOptions: {
        baseAssetPath: "/vad/",
        onnxWASMBasePath: "/ort/",
      },
    });

    await engine.start();

    expect(vadMock.state.options).not.toHaveProperty("positiveSpeechThreshold");
    expect(vadMock.state.options).not.toHaveProperty("negativeSpeechThreshold");
    expect(vadMock.state.options).not.toHaveProperty("redemptionMs");
    expect(vadMock.state.options).not.toHaveProperty("preSpeechPadMs");
    expect(vadMock.state.options).not.toHaveProperty("minSpeechMs");
  });

  it("feeds canonical V5 frames into MicVAD and emits frame probabilities", async () => {
    const engine = createRicky0123VadEngine({
      assetOptions: {
        baseAssetPath: "/vad/",
        onnxWASMBasePath: "/ort/",
      },
    });
    const events: VoiceVadEvent[] = [];
    engine.subscribe((event) => events.push(event));

    vadMock.fakeVad.processFrame.mockImplementation(async (frame) => {
      const onFrameProcessed = vadMock.state.options?.onFrameProcessed as
        | ((probabilities: unknown, frame: Float32Array) => void)
        | undefined;
      onFrameProcessed?.({ isSpeech: 0.8, notSpeech: 0.2 }, frame);
    });

    await engine.start();
    await engine.acceptFrame({
      samples: new Float32Array(512).fill(0.1),
      sampleRate: 16_000,
      timestampMs: 1_250,
    });

    expect(vadMock.fakeVad.processFrame).toHaveBeenCalledTimes(1);
    expect(vadMock.fakeVad.processFrame).toHaveBeenCalledWith(
      expect.any(Float32Array),
    );
    expect(events).toEqual([
      {
        type: "frame",
        frame: {
          samples: expect.any(Float32Array),
          sampleRate: 16_000,
          timestampMs: 1_250,
        },
        probabilities: {
          isSpeech: 0.8,
          notSpeech: 0.2,
        },
      },
    ]);
  });

  it("resamples source frames before processing", async () => {
    const engine = createRicky0123VadEngine({
      assetOptions: {
        baseAssetPath: "/vad/",
        onnxWASMBasePath: "/ort/",
      },
    });

    await engine.start();
    await engine.acceptFrame({
      samples: new Float32Array(1536).fill(0.25),
      sampleRate: 48_000,
      timestampMs: 500,
    });

    expect(vadMock.fakeVad.processFrame).toHaveBeenCalledTimes(1);
    expect(
      (vadMock.fakeVad.processFrame.mock.calls[0][0]).length,
    ).toBe(512);
  });

  it("emits speech lifecycle events from MicVAD callbacks", async () => {
    const engine = createRicky0123VadEngine({
      assetOptions: {
        baseAssetPath: "/vad/",
        onnxWASMBasePath: "/ort/",
      },
    });
    const events: VoiceVadEvent[] = [];
    engine.subscribe((event) => events.push(event));

    const speechAudio = new Float32Array([0.1, 0.2]);
    vadMock.fakeVad.processFrame.mockImplementation(async () => {
      (vadMock.state.options?.onSpeechStart as (() => void) | undefined)?.();
      (
        vadMock.state.options?.onSpeechRealStart as (() => void) | undefined
      )?.();
      (
        vadMock.state.options?.onSpeechEnd as
          | ((audio: Float32Array) => void)
          | undefined
      )?.(speechAudio);
      (vadMock.state.options?.onVADMisfire as (() => void) | undefined)?.();
    });

    await engine.start();
    await engine.acceptFrame({
      samples: new Float32Array(512).fill(0.1),
      sampleRate: 16_000,
      timestampMs: 900,
    });

    expect(events).toEqual([
      { type: "speech_start", timestampMs: 900 },
      { type: "speech_real_start", timestampMs: 900 },
      { type: "speech_end", timestampMs: 900, audio: speechAudio },
      { type: "vad_misfire", timestampMs: 900 },
    ]);
  });

  it("ignores unsubscribed listeners", async () => {
    const engine = createRicky0123VadEngine({
      assetOptions: {
        baseAssetPath: "/vad/",
        onnxWASMBasePath: "/ort/",
      },
    });
    const listener = vi.fn();
    const unsubscribe = engine.subscribe(listener);
    unsubscribe();

    vadMock.fakeVad.processFrame.mockImplementation(async () => {
      (vadMock.state.options?.onSpeechStart as (() => void) | undefined)?.();
    });

    await engine.start();
    await engine.acceptFrame({
      samples: new Float32Array(512),
      sampleRate: 16_000,
      timestampMs: 0,
    });

    expect(listener).not.toHaveBeenCalled();
  });

  it("requires start before accepting frames", async () => {
    const engine = createRicky0123VadEngine({
      assetOptions: {
        baseAssetPath: "/vad/",
        onnxWASMBasePath: "/ort/",
      },
    });

    await expect(
      engine.acceptFrame({
        samples: new Float32Array(512),
        sampleRate: 16_000,
        timestampMs: 0,
      }),
    ).rejects.toThrow(/Start the VAD engine/);
  });

  it("resets buffered state on stop and releases the model on destroy", async () => {
    const engine = createRicky0123VadEngine({
      assetOptions: {
        baseAssetPath: "/vad/",
        onnxWASMBasePath: "/ort/",
      },
    });

    await engine.start();
    engine.stop();
    engine.destroy();

    expect(vadMock.fakeVad.frameProcessor.reset).toHaveBeenCalled();
    expect(vadMock.fakeVad.model.reset_state).toHaveBeenCalled();
    expect(vadMock.fakeVad.model.release).toHaveBeenCalledTimes(1);
  });
});
