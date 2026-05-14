export type VoiceVadModel = "silero-v5" | "silero-legacy";

export type VoiceVadFrame = {
  samples: Float32Array;
  sampleRate: number;
  timestampMs: number;
};

export type VoiceVadFrameResult = {
  speechProbability: number;
  isSpeech: boolean;
};

export type VoiceVadEvent =
  | {
      type: "frame";
      frame: VoiceVadFrame;
      result: VoiceVadFrameResult;
    }
  | {
      type: "speech_start";
      timestampMs: number;
      speechProbability: number;
    }
  | {
      type: "speech_end";
      timestampMs: number;
    }
  | {
      type: "error";
      error: Error;
    };

export type VoiceVadEventListener = (event: VoiceVadEvent) => void;

export type VoiceVadEngineOptions = {
  model?: VoiceVadModel;
  positiveSpeechThreshold?: number;
  negativeSpeechThreshold?: number;
  redemptionMs?: number;
  preSpeechPadMs?: number;
  minSpeechMs?: number;
};

export interface VoiceVadEngine {
  start(): Promise<void>;
  stop(): void;
  destroy(): void;
  acceptFrame(frame: VoiceVadFrame): Promise<VoiceVadFrameResult>;
  subscribe(listener: VoiceVadEventListener): () => void;
}
