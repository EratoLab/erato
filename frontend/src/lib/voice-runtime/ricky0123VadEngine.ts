/* eslint-disable lingui/no-unlocalized-strings -- internal event-type discriminators and package imports, never user-facing */
import {
  createRicky0123VadAssetOptions,
  type Ricky0123VadAssetOptions,
} from "./ricky0123Vad";
import {
  type VoiceVadEngine,
  type VoiceVadEngineOptions,
  type VoiceVadEvent,
  type VoiceVadEventListener,
  type VoiceVadFrame,
  type VoiceVadFrameProbabilities,
  type VoiceVadModel,
} from "./vadEngine";

import type { VoiceRuntimeAssetOverrides } from "./assets";
import type { MicVAD, RealTimeVADOptions } from "@ricky0123/vad-web";

const SILERO_SAMPLE_RATE_HZ = 16_000;
const SILERO_V5_FRAME_SAMPLES = 512;
const SILERO_LEGACY_FRAME_SAMPLES = 1536;

type Ricky0123Model = "v5" | "legacy";

type Ricky0123VadEngineState = "idle" | "started" | "stopped" | "destroyed";

type Ricky0123VadPrivateInternals = {
  frameProcessor?: {
    resume?: () => void;
    reset?: () => void;
  };
  model?: {
    reset_state?: () => void;
    release?: () => Promise<void>;
  };
};

export type Ricky0123VadEngineOptions = VoiceVadEngineOptions & {
  assets?: VoiceRuntimeAssetOverrides | string;
  assetOptions?: Ricky0123VadAssetOptions;
};

class StreamingFloat32Resampler {
  private sourceSampleRate: number | null = null;
  private sourceSamples: number[] = [];
  private sourceCursor = 0;

  reset(): void {
    this.sourceSampleRate = null;
    this.sourceSamples = [];
    this.sourceCursor = 0;
  }

  accept(samples: Float32Array, sourceSampleRate: number): Float32Array {
    if (!Number.isFinite(sourceSampleRate) || sourceSampleRate <= 0) {
      throw new Error(`Invalid VAD source sample rate: ${sourceSampleRate}`);
    }
    if (samples.length === 0) {
      return new Float32Array();
    }

    if (sourceSampleRate === SILERO_SAMPLE_RATE_HZ) {
      this.reset();
      this.sourceSampleRate = sourceSampleRate;
      return new Float32Array(samples);
    }

    if (this.sourceSampleRate !== sourceSampleRate) {
      this.reset();
      this.sourceSampleRate = sourceSampleRate;
    }

    for (let index = 0; index < samples.length; index += 1) {
      this.sourceSamples.push(samples[index]);
    }

    const rateRatio = sourceSampleRate / SILERO_SAMPLE_RATE_HZ;
    const output: number[] = [];
    while (this.sourceCursor + 1 < this.sourceSamples.length) {
      const sourceIndex = Math.floor(this.sourceCursor);
      const nextSourceIndex = Math.min(
        sourceIndex + 1,
        this.sourceSamples.length - 1,
      );
      const interpolation = this.sourceCursor - sourceIndex;
      output.push(
        this.sourceSamples[sourceIndex] * (1 - interpolation) +
          this.sourceSamples[nextSourceIndex] * interpolation,
      );
      this.sourceCursor += rateRatio;
    }

    const consumedSamples = Math.floor(this.sourceCursor);
    if (consumedSamples > 0) {
      this.sourceSamples = this.sourceSamples.slice(consumedSamples);
      this.sourceCursor -= consumedSamples;
    }

    return new Float32Array(output);
  }
}

function toRicky0123Model(model: VoiceVadModel | undefined): Ricky0123Model {
  return model === "silero-legacy" ? "legacy" : "v5";
}

function frameSamplesForModel(model: Ricky0123Model): number {
  return model === "legacy"
    ? SILERO_LEGACY_FRAME_SAMPLES
    : SILERO_V5_FRAME_SAMPLES;
}

function timestampForTargetSample(
  baseTimestampMs: number | null,
  processedTargetSamples: number,
): number {
  return (
    (baseTimestampMs ?? 0) +
    (processedTargetSamples / SILERO_SAMPLE_RATE_HZ) * 1000
  );
}

export class Ricky0123VadEngine implements VoiceVadEngine {
  private readonly listeners = new Set<VoiceVadEventListener>();
  private readonly model: Ricky0123Model;
  private readonly frameSamples: number;
  private readonly assetOptions: Ricky0123VadAssetOptions;
  private readonly resampler = new StreamingFloat32Resampler();
  private readonly pendingTargetSamples: number[] = [];
  private state: Ricky0123VadEngineState = "idle";
  private vad: MicVAD | null = null;
  private baseTimestampMs: number | null = null;
  private processedTargetSamples = 0;
  private currentFrameTimestampMs = 0;

  constructor(private readonly options: Ricky0123VadEngineOptions = {}) {
    this.model = toRicky0123Model(options.model);
    this.frameSamples = frameSamplesForModel(this.model);
    this.assetOptions =
      options.assetOptions ?? createRicky0123VadAssetOptions(options.assets);
  }

  async start(): Promise<void> {
    if (this.state === "destroyed") {
      throw new Error("Cannot start a destroyed VAD engine.");
    }

    if (!this.vad) {
      const { MicVAD } = await import("@ricky0123/vad-web");
      this.vad = await MicVAD.new(this.createMicVadOptions());
    } else {
      this.resetUnderlyingState();
    }

    this.state = "started";
    this.resetFrameBuffers();
    this.resumeUnderlyingFrameProcessor();
  }

  stop(): void {
    if (this.state === "destroyed") {
      return;
    }

    this.state = "stopped";
    this.resetFrameBuffers();
    this.resetUnderlyingState();
  }

  destroy(): void {
    if (this.state === "destroyed") {
      return;
    }

    this.stop();
    this.state = "destroyed";

    const release = (this.vad as Ricky0123VadPrivateInternals | null)?.model
      ?.release;
    if (release) {
      void release().catch((error: unknown) => {
        this.emit({
          type: "error",
          error: error instanceof Error ? error : new Error(String(error)),
        });
      });
    }
    this.vad = null;
  }

  async acceptFrame(frame: VoiceVadFrame): Promise<void> {
    if (this.state === "destroyed") {
      throw new Error("Cannot process frames with a destroyed VAD engine.");
    }
    if (this.state !== "started") {
      throw new Error("Start the VAD engine before processing frames.");
    }
    if (!this.vad) {
      throw new Error("VAD engine has not finished starting.");
    }

    if (this.baseTimestampMs === null) {
      this.baseTimestampMs = frame.timestampMs;
    }

    try {
      const targetSamples = this.resampler.accept(
        frame.samples,
        frame.sampleRate,
      );
      for (let index = 0; index < targetSamples.length; index += 1) {
        this.pendingTargetSamples.push(targetSamples[index]);
      }

      while (this.pendingTargetSamples.length >= this.frameSamples) {
        const vadFrame = new Float32Array(
          this.pendingTargetSamples.splice(0, this.frameSamples),
        );
        this.currentFrameTimestampMs = timestampForTargetSample(
          this.baseTimestampMs,
          this.processedTargetSamples,
        );
        await this.vad.processFrame(vadFrame);
        this.processedTargetSamples += this.frameSamples;
      }
    } catch (error) {
      const normalizedError =
        error instanceof Error ? error : new Error(String(error));
      this.emit({ type: "error", error: normalizedError });
      throw normalizedError;
    }
  }

  subscribe(listener: VoiceVadEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private createMicVadOptions(): Partial<RealTimeVADOptions> {
    const options: Partial<RealTimeVADOptions> = {
      ...this.assetOptions,
      model: this.model,
      startOnLoad: false,
      onFrameProcessed: (
        probabilities: VoiceVadFrameProbabilities,
        processedFrame: Float32Array,
      ) => {
        this.emit({
          type: "frame",
          frame: {
            samples: processedFrame,
            sampleRate: SILERO_SAMPLE_RATE_HZ,
            timestampMs: this.currentFrameTimestampMs,
          },
          probabilities,
        });
      },
      onSpeechStart: () => {
        this.emit({
          type: "speech_start",
          timestampMs: this.currentFrameTimestampMs,
        });
      },
      onSpeechRealStart: () => {
        this.emit({
          type: "speech_real_start",
          timestampMs: this.currentFrameTimestampMs,
        });
      },
      onSpeechEnd: (audio: Float32Array) => {
        this.emit({
          type: "speech_end",
          timestampMs: this.currentFrameTimestampMs,
          audio,
        });
      },
      onVADMisfire: () => {
        this.emit({
          type: "vad_misfire",
          timestampMs: this.currentFrameTimestampMs,
        });
      },
    };

    if (this.options.positiveSpeechThreshold !== undefined) {
      options.positiveSpeechThreshold = this.options.positiveSpeechThreshold;
    }
    if (this.options.negativeSpeechThreshold !== undefined) {
      options.negativeSpeechThreshold = this.options.negativeSpeechThreshold;
    }
    if (this.options.redemptionMs !== undefined) {
      options.redemptionMs = this.options.redemptionMs;
    }
    if (this.options.preSpeechPadMs !== undefined) {
      options.preSpeechPadMs = this.options.preSpeechPadMs;
    }
    if (this.options.minSpeechMs !== undefined) {
      options.minSpeechMs = this.options.minSpeechMs;
    }

    return options;
  }

  private resetFrameBuffers(): void {
    this.resampler.reset();
    this.pendingTargetSamples.length = 0;
    this.baseTimestampMs = null;
    this.processedTargetSamples = 0;
    this.currentFrameTimestampMs = 0;
  }

  private resetUnderlyingState(): void {
    const internals = this.vad as Ricky0123VadPrivateInternals | null;
    internals?.frameProcessor?.reset?.();
    internals?.model?.reset_state?.();
  }

  private resumeUnderlyingFrameProcessor(): void {
    const internals = this.vad as Ricky0123VadPrivateInternals | null;
    internals?.frameProcessor?.resume?.();
  }

  private emit(event: VoiceVadEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

export function createRicky0123VadEngine(
  options: Ricky0123VadEngineOptions = {},
): VoiceVadEngine {
  return new Ricky0123VadEngine(options);
}
