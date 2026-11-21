import { SPEECH_FRAME_PROBABILITY } from "./audioTuning";

/**
 * What the speech detector heard in one recording, for deciding by voice:
 * when it started on the device's clock, and its speech by the time of the
 * microphone's own samples from there.
 */
export type RecordingSignals = {
  startedAt: number;
  endedAt: number;
  firstSpeechAt: number | null;
  speechMs: number;
  /** The microphone's audio the detector judged. */
  recordedMs: number;
  /** Opened while the voice spoke. */
  overVoice: boolean;
  /**
   * Synthetic silence the detector judges before the microphone's first
   * sample. It is not time that passed, so it moves no time measured here.
   */
  leadInMs: number;
  /** All audio the detector judged, the lead-in included. */
  judgedMs: number;
};

export const recordingSignals = (
  startedAt: number,
  overVoice: boolean,
  leadInMs = 0,
): RecordingSignals => ({
  startedAt,
  endedAt: startedAt,
  firstSpeechAt: null,
  speechMs: 0,
  recordedMs: 0,
  overVoice,
  leadInMs,
  judgedMs: 0,
});

/** The signals after one detector frame of `frameMs` with `probability`. */
export const withFrame = (
  signals: RecordingSignals,
  frameMs: number,
  probability: number,
): RecordingSignals => {
  const microphoneMs = (judged: number) =>
    Math.max(0, judged - signals.leadInMs);
  const judgedMs = signals.judgedMs + frameMs;
  const speech = probability >= SPEECH_FRAME_PROBABILITY;
  return {
    ...signals,
    judgedMs,
    recordedMs: microphoneMs(judgedMs),
    endedAt: signals.startedAt + microphoneMs(judgedMs),
    speechMs: signals.speechMs + (speech ? frameMs : 0),
    firstSpeechAt:
      signals.firstSpeechAt ??
      (speech ? signals.startedAt + microphoneMs(signals.judgedMs) : null),
  };
};
