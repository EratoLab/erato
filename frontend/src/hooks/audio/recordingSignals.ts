import { SPEECH_FRAME_PROBABILITY } from "./audioTuning";

/**
 * What the speech detector heard in one recording, for deciding by voice:
 * when it started on the device's clock, and its speech by sample time from
 * there.
 */
export type RecordingSignals = {
  /** When the recording was asked for. */
  startedAt: number;
  endedAt: number;
  firstSpeechAt: number | null;
  speechMs: number;
  recordedMs: number;
  /** Opened while the voice spoke. */
  overVoice: boolean;
  /** Where the detector's first frame lies on the device's clock. */
  audioAt: number;
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
  audioAt: startedAt,
});

/**
 * The microphone's first sample arrived at `firstAudioAt`, behind `leadMs` of
 * silence the detector hears first: its frames are timed from there, not
 * from when the recording was asked for. Opening the microphone takes time
 * that yields no frames, and the silence is frames that took no time.
 */
export const audioFrom = (
  signals: RecordingSignals,
  firstAudioAt: number,
  leadMs: number,
): RecordingSignals => {
  const audioAt = firstAudioAt - leadMs;
  const shift = audioAt - signals.audioAt;
  return {
    ...signals,
    audioAt,
    endedAt: signals.endedAt + shift,
    firstSpeechAt:
      signals.firstSpeechAt === null ? null : signals.firstSpeechAt + shift,
  };
};

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
    endedAt: signals.audioAt + recordedMs,
    speechMs: signals.speechMs + (speech ? frameMs : 0),
    firstSpeechAt:
      signals.firstSpeechAt ??
      (speech ? signals.audioAt + signals.recordedMs : null),
  };
};
