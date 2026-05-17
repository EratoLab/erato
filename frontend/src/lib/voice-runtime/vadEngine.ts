export type VoiceVadModel = "silero-v5" | "silero-legacy";

export type VoiceVadFrame = {
  samples: Float32Array;
  sampleRate: number;
  timestampMs: number;
};

export type VoiceVadFrameProbabilities = {
  isSpeech: number;
  notSpeech: number;
};

export type VoiceVadEvent =
  | {
      type: "frame";
      frame: VoiceVadFrame;
      probabilities: VoiceVadFrameProbabilities;
    }
  | {
      type: "speech_start";
      timestampMs: number;
    }
  | {
      type: "speech_real_start";
      timestampMs: number;
    }
  | {
      type: "speech_end";
      timestampMs: number;
      audio: Float32Array;
    }
  | {
      type: "vad_misfire";
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
  acceptFrame(frame: VoiceVadFrame): Promise<void>;
  subscribe(listener: VoiceVadEventListener): () => void;
}
