import { SPEECH_FRAME_PROBABILITY } from "./audioTuning";

/**
 * What the speech detector heard in one recording, for deciding by voice:
 * when it started on the device's clock, and its speech by sample time from
 * there.
 */
export type RecordingSignals = {
  startedAt: number;
  endedAt: number;
  firstSpeechAt: number | null;
  speechMs: number;
  recordedMs: number;
  /** Opened while the voice spoke. */
  overVoice: boolean;
};

export const recordingSignals = (
  startedAt: number,
  overVoice: boolean,
): RecordingSignals => ({
  startedAt,
  endedAt: startedAt,
  firstSpeechAt: null,
  speechMs: 0,
  recordedMs: 0,
  overVoice,
});

/** The signals after one detector frame of `frameMs` with `probability`. */
export const withFrame = (
  signals: RecordingSignals,
  frameMs: number,
  probability: number,
): RecordingSignals => {
  const recordedMs = signals.recordedMs + frameMs;
  const speech = probability >= SPEECH_FRAME_PROBABILITY;
  return {
    ...signals,
    recordedMs,
    endedAt: signals.startedAt + recordedMs,
    speechMs: signals.speechMs + (speech ? frameMs : 0),
    firstSpeechAt:
      signals.firstSpeechAt ??
      (speech ? signals.startedAt + signals.recordedMs : null),
  };
};
