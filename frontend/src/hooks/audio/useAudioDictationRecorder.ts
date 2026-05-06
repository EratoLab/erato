import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useRef, useState } from "react";
/* eslint-disable lingui/no-unlocalized-strings */

import { useAudioInputDevicePreference } from "./useAudioInputDevicePreference";

const CANONICAL_AUDIO_SAMPLE_RATE_HZ = 16_000;
const CANONICAL_AUDIO_WAV_HEADER_BYTES = 44;
const CANONICAL_AUDIO_BYTES_PER_SAMPLE = 2;
const DEFAULT_AUDIO_DICTATION_CHUNK_DURATION_MS = 30_000;
const AUDIO_BARS_COUNT = 5;

type AudioDictationSocketFrame =
  | {
      type: "session_state";
      next_chunk_index?: number;
      chunk_duration_ms?: number;
    }
  | {
      type: "chunk_ack";
      chunk_index: number;
    }
  | {
      type: "chunk_transcribed";
      chunk_index: number;
      transcript?: string | null;
    }
  | {
      type: "completed";
    }
  | {
      type: "error";
      error?: string | null;
    };

type LiveAudioDictationSession = {
  socket: WebSocket;
  chunkDurationMs: number;
  nextChunkIndex: number;
  sendQueue: Promise<void>;
  sentPcmBytes: number;
  pendingSourceSamples: number[];
  sourceSampleRate: number;
};

export type AudioDictationTranscriptChunk = {
  chunkIndex: number;
  transcript: string;
};

export type AudioDictationDiagnostics = {
  channelCount?: number;
  sampleRate?: number;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
};

type UseAudioDictationRecorderOptions = {
  enabled: boolean;
  maxRecordingDurationSeconds: number;
  onTranscriptChunk: (chunk: AudioDictationTranscriptChunk) => void;
};

function createAudioDictationWebSocketUrl(): string {
  const url = new URL(
    "/api/v1beta/me/audio-dictation/socket",
    window.location.href,
  );
  url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function sendAudioDictationControlFrame(
  socket: WebSocket,
  frame: Record<string, unknown>,
) {
  socket.send(JSON.stringify(frame));
}

function waitForSocketOpen(socket: WebSocket): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener(
      "error",
      () => reject(new Error(t`Audio dictation connection failed.`)),
      { once: true },
    );
  });
}

function waitForAudioDictationFrame(
  socket: WebSocket,
  predicate: (frame: AudioDictationSocketFrame) => boolean,
): Promise<AudioDictationSocketFrame> {
  return new Promise<AudioDictationSocketFrame>((resolve, reject) => {
    const handleMessage = (event: MessageEvent) => {
      if (typeof event.data !== "string") {
        return;
      }

      try {
        const frame = JSON.parse(event.data) as AudioDictationSocketFrame;
        if (frame.type === "error") {
          cleanup();
          reject(new Error(frame.error ?? t`Audio dictation failed.`));
          return;
        }

        if (predicate(frame)) {
          cleanup();
          resolve(frame);
        }
      } catch (error) {
        cleanup();
        reject(
          error instanceof Error
            ? error
            : new Error(t`Could not read audio dictation response.`),
        );
      }
    };

    const handleError = () => {
      cleanup();
      reject(new Error(t`Audio dictation connection failed.`));
    };

    const cleanup = () => {
      socket.removeEventListener("message", handleMessage);
      socket.removeEventListener("error", handleError);
    };

    socket.addEventListener("message", handleMessage);
    socket.addEventListener("error", handleError);
  });
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function createCanonicalWavBytesFromPcm(pcmBytes: Uint8Array): Uint8Array {
  const wavBytes = new Uint8Array(
    CANONICAL_AUDIO_WAV_HEADER_BYTES + pcmBytes.length,
  );
  const view = new DataView(wavBytes.buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + pcmBytes.length, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, CANONICAL_AUDIO_SAMPLE_RATE_HZ, true);
  view.setUint32(
    28,
    CANONICAL_AUDIO_SAMPLE_RATE_HZ * CANONICAL_AUDIO_BYTES_PER_SAMPLE,
    true,
  );
  view.setUint16(32, CANONICAL_AUDIO_BYTES_PER_SAMPLE, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, pcmBytes.length, true);
  wavBytes.set(pcmBytes, CANONICAL_AUDIO_WAV_HEADER_BYTES);

  return wavBytes;
}

function resampleMonoFloat32ToPcm16(
  samples: Float32Array,
  sourceSampleRate: number,
): Uint8Array {
  const targetSampleCount = Math.max(
    1,
    Math.round(
      (samples.length * CANONICAL_AUDIO_SAMPLE_RATE_HZ) / sourceSampleRate,
    ),
  );
  const pcmBytes = new Uint8Array(
    targetSampleCount * CANONICAL_AUDIO_BYTES_PER_SAMPLE,
  );
  const view = new DataView(pcmBytes.buffer);
  const rateRatio = sourceSampleRate / CANONICAL_AUDIO_SAMPLE_RATE_HZ;

  for (
    let targetSampleIndex = 0;
    targetSampleIndex < targetSampleCount;
    targetSampleIndex += 1
  ) {
    const sourcePosition = targetSampleIndex * rateRatio;
    const sourceIndex = Math.floor(sourcePosition);
    const nextSourceIndex = Math.min(sourceIndex + 1, samples.length - 1);
    const interpolation = sourcePosition - sourceIndex;
    const sample =
      samples[sourceIndex] * (1 - interpolation) +
      samples[nextSourceIndex] * interpolation;
    const clampedSample = Math.max(-1, Math.min(1, sample));
    view.setInt16(
      targetSampleIndex * CANONICAL_AUDIO_BYTES_PER_SAMPLE,
      clampedSample < 0 ? clampedSample * 0x8000 : clampedSample * 0x7fff,
      true,
    );
  }

  return pcmBytes;
}

function mediaTrackSettingsToDiagnostics(
  settings: MediaTrackSettings,
): AudioDictationDiagnostics {
  return {
    channelCount: settings.channelCount,
    sampleRate: settings.sampleRate,
    echoCancellation: settings.echoCancellation,
    noiseSuppression: settings.noiseSuppression,
    autoGainControl: settings.autoGainControl,
  };
}

export function useAudioDictationRecorder({
  enabled,
  maxRecordingDurationSeconds,
  onTranscriptChunk,
}: UseAudioDictationRecorderOptions) {
  const [isDictating, setIsDictating] = useState(false);
  const [isDictationStarting, setIsDictationStarting] = useState(false);
  const [dictationError, setDictationError] = useState<string | null>(null);
  const [dictationBars, setDictationBars] = useState<number[]>(
    Array.from({ length: AUDIO_BARS_COUNT }, () => 2),
  );
  const [dictationDiagnostics, setDictationDiagnostics] =
    useState<AudioDictationDiagnostics | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const liveSessionRef = useRef<LiveAudioDictationSession | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioAnalyserRef = useRef<AnalyserNode | null>(null);
  const audioSourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const audioProcessorSinkRef = useRef<GainNode | null>(null);
  const audioLevelDataRef = useRef<Uint8Array | null>(null);
  const audioFrameRef = useRef<number | null>(null);
  const recordingDurationTimerRef = useRef<number | null>(null);
  const onTranscriptChunkRef = useRef(onTranscriptChunk);
  const { selectedAudioInputDeviceId } = useAudioInputDevicePreference();

  useEffect(() => {
    onTranscriptChunkRef.current = onTranscriptChunk;
  }, [onTranscriptChunk]);

  const clearRecordingDurationTimer = useCallback(() => {
    if (recordingDurationTimerRef.current !== null) {
      window.clearTimeout(recordingDurationTimerRef.current);
      recordingDurationTimerRef.current = null;
    }
  }, []);

  const stopRecordingVisualizer = useCallback(() => {
    if (audioFrameRef.current !== null) {
      window.cancelAnimationFrame(audioFrameRef.current);
      audioFrameRef.current = null;
    }

    audioAnalyserRef.current?.disconnect();
    audioAnalyserRef.current = null;
    audioSourceNodeRef.current?.disconnect();
    audioSourceNodeRef.current = null;
    audioProcessorRef.current?.disconnect();
    audioProcessorRef.current = null;
    audioProcessorSinkRef.current?.disconnect();
    audioProcessorSinkRef.current = null;
    audioLevelDataRef.current = null;

    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      void audioContextRef.current.close();
    }
    audioContextRef.current = null;
    setDictationBars(Array.from({ length: AUDIO_BARS_COUNT }, () => 2));
  }, []);

  const stopMediaRecordingStream = useCallback(() => {
    clearRecordingDurationTimer();

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    stopRecordingVisualizer();
  }, [clearRecordingDurationTimer, stopRecordingVisualizer]);

  const sendLivePcmChunk = useCallback((pcmBytes: Uint8Array) => {
    const session = liveSessionRef.current;
    if (!session || pcmBytes.length === 0) {
      return;
    }

    session.sendQueue = session.sendQueue.then(async () => {
      if (session.socket.readyState !== WebSocket.OPEN) {
        return;
      }

      const chunkIndex = session.nextChunkIndex;
      const startMs = chunkIndex * session.chunkDurationMs;
      const chunkDurationMs = Math.ceil(
        (pcmBytes.length /
          CANONICAL_AUDIO_BYTES_PER_SAMPLE /
          CANONICAL_AUDIO_SAMPLE_RATE_HZ) *
          1000,
      );
      const endMs =
        startMs + Math.min(chunkDurationMs, session.chunkDurationMs);
      const isFirstChunk = chunkIndex === 0;

      session.nextChunkIndex += 1;
      session.sentPcmBytes += pcmBytes.length;

      sendAudioDictationControlFrame(session.socket, {
        type: "chunk_metadata",
        chunk_index: chunkIndex,
        start_ms: startMs,
        end_ms: endMs,
        content_type: isFirstChunk ? "audio/wav" : "audio/pcm",
      });
      session.socket.send(
        isFirstChunk ? createCanonicalWavBytesFromPcm(pcmBytes) : pcmBytes,
      );
    });
  }, []);

  const flushLiveAudioSamples = useCallback(
    (flushFinalChunk: boolean) => {
      const session = liveSessionRef.current;
      if (!session) {
        return;
      }

      const sourceSamplesPerChunk = Math.max(
        1,
        Math.floor((session.sourceSampleRate * session.chunkDurationMs) / 1000),
      );

      while (
        session.pendingSourceSamples.length >= sourceSamplesPerChunk ||
        (flushFinalChunk && session.pendingSourceSamples.length > 0)
      ) {
        const sourceSampleCount = Math.min(
          sourceSamplesPerChunk,
          session.pendingSourceSamples.length,
        );
        const sourceSamples = new Float32Array(
          session.pendingSourceSamples.splice(0, sourceSampleCount),
        );
        sendLivePcmChunk(
          resampleMonoFloat32ToPcm16(sourceSamples, session.sourceSampleRate),
        );
      }
    },
    [sendLivePcmChunk],
  );

  const startLiveDictationSession =
    useCallback(async (): Promise<LiveAudioDictationSession> => {
      if (!enabled) {
        throw new Error(
          t`Audio dictation is not available in this environment.`,
        );
      }

      setIsDictationStarting(true);
      setDictationError(null);

      const socket = new WebSocket(createAudioDictationWebSocketUrl());
      socket.binaryType = "arraybuffer";

      socket.addEventListener("message", (event) => {
        if (typeof event.data !== "string") {
          return;
        }

        try {
          const frame = JSON.parse(event.data) as AudioDictationSocketFrame;
          if (frame.type === "chunk_transcribed") {
            onTranscriptChunkRef.current({
              chunkIndex: frame.chunk_index,
              transcript: frame.transcript ?? "",
            });
          }
          if (frame.type === "error") {
            setDictationError(frame.error ?? t`Audio dictation failed.`);
          }
        } catch {
          setDictationError(t`Could not read audio dictation response.`);
        }
      });

      socket.addEventListener("error", () => {
        setDictationError(t`Audio dictation connection failed.`);
      });

      await waitForSocketOpen(socket);
      const sessionStatePromise = waitForAudioDictationFrame(
        socket,
        (frame) => frame.type === "session_state",
      );

      sendAudioDictationControlFrame(socket, {
        type: "start",
      });

      const sessionFrame = await sessionStatePromise;
      if (sessionFrame.type !== "session_state") {
        throw new Error(t`Audio dictation did not start.`);
      }

      const session: LiveAudioDictationSession = {
        socket,
        chunkDurationMs:
          sessionFrame.chunk_duration_ms ??
          DEFAULT_AUDIO_DICTATION_CHUNK_DURATION_MS,
        nextChunkIndex: sessionFrame.next_chunk_index ?? 0,
        sendQueue: Promise.resolve(),
        sentPcmBytes: 0,
        pendingSourceSamples: [],
        sourceSampleRate: CANONICAL_AUDIO_SAMPLE_RATE_HZ,
      };
      liveSessionRef.current = session;
      setIsDictationStarting(false);
      return session;
    }, [enabled]);

  const stopDictation = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
      return;
    }

    setIsDictating(false);
    stopMediaRecordingStream();
  }, [stopMediaRecordingStream]);

  const startDictation = useCallback(async () => {
    if (!enabled) {
      setDictationError(
        t`Audio dictation is not available in this environment.`,
      );
      return;
    }

    const mediaDevices =
      typeof navigator === "undefined"
        ? undefined
        : (navigator as Navigator & { mediaDevices?: MediaDevices })
            .mediaDevices;

    if (typeof mediaDevices?.getUserMedia !== "function") {
      setDictationError(t`Audio recording is not supported in this browser.`);
      return;
    }

    try {
      const stream = await mediaDevices.getUserMedia({
        audio: {
          ...(selectedAudioInputDeviceId
            ? { deviceId: { exact: selectedAudioInputDeviceId } }
            : {}),
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: { ideal: 1 },
          sampleRate: { ideal: CANONICAL_AUDIO_SAMPLE_RATE_HZ },
        },
      });
      mediaStreamRef.current = stream;
      const audioTrack = stream.getAudioTracks()[0];
      setDictationDiagnostics(
        mediaTrackSettingsToDiagnostics(audioTrack.getSettings()),
      );

      const liveSession = await startLiveDictationSession();

      if (typeof AudioContext !== "undefined") {
        const audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        const processor = audioContext.createScriptProcessor(4096, 1, 1);
        const processorSink = audioContext.createGain();
        analyser.fftSize = 64;
        processorSink.gain.value = 0;
        source.connect(analyser);
        source.connect(processor);
        processor.connect(processorSink);
        processorSink.connect(audioContext.destination);
        liveSession.sourceSampleRate = audioContext.sampleRate;
        processor.onaudioprocess = (event) => {
          const session = liveSessionRef.current;
          if (!session) {
            return;
          }

          const input = event.inputBuffer.getChannelData(0);
          for (let index = 0; index < input.length; index += 1) {
            session.pendingSourceSamples.push(input[index]);
          }
          flushLiveAudioSamples(false);
        };

        const levelData = new Uint8Array(analyser.frequencyBinCount);

        const analyzeLevel = () => {
          if (!audioAnalyserRef.current || !audioLevelDataRef.current) {
            return;
          }

          audioAnalyserRef.current.getByteFrequencyData(
            audioLevelDataRef.current,
          );

          const audioLevelData = audioLevelDataRef.current;
          const binsPerBar = Math.max(
            1,
            Math.floor(audioLevelData.length / AUDIO_BARS_COUNT),
          );

          const nextBars = Array.from(
            { length: AUDIO_BARS_COUNT },
            (_, barIndex) => {
              const startBin = barIndex * binsPerBar;
              const endBin =
                barIndex + 1 === AUDIO_BARS_COUNT
                  ? audioLevelData.length
                  : (barIndex + 1) * binsPerBar;
              let total = 0;

              for (let index = startBin; index < endBin; index++) {
                total += audioLevelData[index];
              }

              const average = total / (endBin - startBin);
              return Math.max(2, Math.round((average / 255) * 16));
            },
          );

          setDictationBars(nextBars);
          audioFrameRef.current = window.requestAnimationFrame(analyzeLevel);
        };

        audioContextRef.current = audioContext;
        audioAnalyserRef.current = analyser;
        audioSourceNodeRef.current = source;
        audioProcessorRef.current = processor;
        audioProcessorSinkRef.current = processorSink;
        audioLevelDataRef.current = levelData;
        audioFrameRef.current = window.requestAnimationFrame(analyzeLevel);
      } else {
        setDictationBars((existingBars) =>
          existingBars.length === AUDIO_BARS_COUNT
            ? [2, 2, 6, 2, 2]
            : Array.from({ length: AUDIO_BARS_COUNT }, () => 2),
        );
      }

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.onstop = () => {
        clearRecordingDurationTimer();
        setIsDictating(false);
        stopMediaRecordingStream();

        void (async () => {
          const session = liveSessionRef.current;
          try {
            if (!session) {
              return;
            }

            flushLiveAudioSamples(true);
            await session.sendQueue;

            if (session.sentPcmBytes === 0) {
              setDictationError(
                t`No audio was captured. Please try recording again.`,
              );
              return;
            }

            const completedFramePromise = waitForAudioDictationFrame(
              session.socket,
              (frame) => frame.type === "completed",
            );
            sendAudioDictationControlFrame(session.socket, {
              type: "finish",
            });
            await completedFramePromise;
          } catch (error) {
            setDictationError(
              error instanceof Error
                ? error.message
                : t`Failed to complete audio dictation.`,
            );
          } finally {
            liveSessionRef.current = null;
            session?.socket.close();
          }
        })();
      };

      mediaRecorder.onerror = (event: Event) => {
        const error = (event as ErrorEvent).error;
        liveSessionRef.current?.socket.close();
        liveSessionRef.current = null;
        stopMediaRecordingStream();
        setIsDictating(false);
        setIsDictationStarting(false);
        setDictationError(
          error instanceof Error
            ? error.message
            : t`Could not complete audio dictation.`,
        );
      };

      mediaRecorder.start();
      clearRecordingDurationTimer();
      const recordingLimitMs = Math.max(
        1,
        Math.ceil(maxRecordingDurationSeconds),
      );
      recordingDurationTimerRef.current = window.setTimeout(() => {
        stopDictation();
        setDictationError(
          t`Dictation stopped automatically after the configured maximum duration.`,
        );
      }, recordingLimitMs * 1000);
      setIsDictating(true);
      setDictationError(null);
    } catch (error) {
      liveSessionRef.current?.socket.close();
      liveSessionRef.current = null;
      stopMediaRecordingStream();
      setIsDictating(false);
      setIsDictationStarting(false);
      setDictationError(
        error instanceof Error
          ? error.message
          : t`Could not start audio dictation.`,
      );
    }
  }, [
    clearRecordingDurationTimer,
    enabled,
    flushLiveAudioSamples,
    maxRecordingDurationSeconds,
    selectedAudioInputDeviceId,
    startLiveDictationSession,
    stopDictation,
    stopMediaRecordingStream,
  ]);

  const toggleDictation = useCallback(() => {
    if (isDictating) {
      stopDictation();
      return;
    }

    void startDictation();
  }, [isDictating, startDictation, stopDictation]);

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }

      liveSessionRef.current?.socket.close();
      liveSessionRef.current = null;
      stopMediaRecordingStream();
    };
  }, [stopMediaRecordingStream]);

  return {
    isDictating,
    isDictationStarting,
    dictationError,
    setDictationError,
    dictationBars,
    dictationDiagnostics,
    toggleDictation,
  };
}
