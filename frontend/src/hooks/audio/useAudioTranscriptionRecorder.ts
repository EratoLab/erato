import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMountedState } from "react-use";
import { useThrottledCallback } from "use-debounce";
/* eslint-disable lingui/no-unlocalized-strings */

import {
  fetchGetFile,
  useCreateChat,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { useV1betaApiContext } from "@/lib/generated/v1betaApi/v1betaApiContext";
import { createRicky0123VadEngine } from "@/lib/voice-runtime";
import { createLogger } from "@/utils/debugLogger";

// `?worker&url` routes the worklet through Vite's worker bundling
// pipeline — see useAudioDictationRecorder for why the canonical
// `new URL(..., import.meta.url)` pattern does not work for TS worklets.
import audioDictationWorkletUrl from "./audio-dictation-worklet.ts?worker&url";
import {
  AUDIO_BARS_COUNT,
  CANONICAL_AUDIO_BYTES_PER_SAMPLE,
  CANONICAL_AUDIO_SAMPLE_RATE_HZ,
  CANONICAL_AUDIO_WAV_HEADER_BYTES,
  createCanonicalWavBytesFromPcm,
  getAudioLevelBarsFromTimeDomainData,
  resampleMonoFloat32ToPcm16,
} from "./audio-pcm-codec";
import { getAudioEnvironment } from "./audioEnvironment";
import { PRE_SPEECH_SILENCE_PRIMER_MS } from "./audioTuning";
import {
  createSpeechOnsetController,
  type SpeechOnsetController,
} from "./onsetFlipController";
import { useAudioContextInterruptionRecovery } from "./useAudioContextInterruptionRecovery";
import { useAudioInputDevicePreference } from "./useAudioInputDevicePreference";
import {
  useMediaStreamTrackWatchdog,
  type TrackLossReason,
} from "./useMediaStreamTrackWatchdog";

import type {
  AudioTranscriptionMetadata,
  ChatModel,
  FileUploadItem,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { VoiceVadEngine } from "@/lib/voice-runtime";

const DEFAULT_AUDIO_TRANSCRIPTION_CHUNK_DURATION_MS = 30_000;
const VAD_DEBUG_FRAME_LOG_INTERVAL_MS = 2_000;

/**
 * The transcription recorder shares the dictation recorder's worklet
 * module (and therefore its registered processor name): both need the
 * same "batch render quanta to 4096-sample frames on the audio render
 * thread" behavior.
 */
const AUDIO_TRANSCRIPTION_WORKLET_PROCESSOR_NAME = "audio-dictation-processor";

const logger = createLogger("HOOK", "useAudioTranscriptionRecorder");

function formatAudioRecordingFilename(date: Date): string {
  const year = date.getFullYear().toString();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  const hour = date.getHours().toString().padStart(2, "0");
  const minute = date.getMinutes().toString().padStart(2, "0");

  return `audio-recording-${year}${month}${day}-${hour}${minute}.wav`;
}

type AudioTranscriptionSocketFrame =
  | {
      type: "session_state";
      file_upload_id: string;
      next_chunk_index?: number;
      stored_offset?: number;
      chunk_duration_ms?: number;
      audio_transcription?: AudioTranscriptionMetadata;
    }
  | {
      type: "chunk_ack";
      file_upload_id: string;
      chunk_index: number;
      byte_start?: number;
      byte_end?: number;
    }
  | {
      type: "chunk_transcribed";
      file_upload_id: string;
      chunk_index: number;
      transcript?: string | null;
      audio_transcription?: AudioTranscriptionMetadata;
    }
  | {
      type: "chunk_failed";
      file_upload_id: string;
      chunk_index: number;
      error?: string | null;
      audio_transcription?: AudioTranscriptionMetadata;
    }
  | {
      type: "completed";
      file_upload_id: string;
      transcript?: string | null;
      audio_transcription?: AudioTranscriptionMetadata;
    }
  | {
      type: "error";
      error?: string | null;
    };

type AudioTranscriptionChunk = {
  index: number;
  startMs: number;
  endMs: number;
  contentType: "audio/wav" | "audio/pcm";
  bytes: Uint8Array;
};

type LiveAudioTranscriptionSession = {
  socket: WebSocket;
  fileUploadId: string;
  /** Recording filename; carried on the session so the deferred
   *  finalization can build the retry source File after teardown. */
  filename: string;
  chunkDurationMs: number;
  nextChunkIndex: number;
  startedAtMs: number;
  sendQueue: Promise<void>;
  pcmParts: Uint8Array[];
  pendingSourceSamples: number[];
  sourceSampleRate: number;
  /** Cumulative canonical-PCM bytes accepted for sending (tracked
   *  synchronously at enqueue time), used to clamp the recording to the
   *  configured maximum duration the backend enforces strictly. */
  queuedPcmBytes: number;
};

export type AudioRecordingDiagnostics = {
  channelCount?: number;
  sampleRate?: number;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
};

type UseAudioTranscriptionRecorderOptions = {
  audioTranscriptionEnabled: boolean;
  uploadEnabled: boolean;
  maxRecordingDurationSeconds: number;
  vadAutoStopEnabled?: boolean;
  onVadAutoStop?: () => void;
  chatId?: string | null;
  silentChatId?: string | null;
  setSilentChatId: (chatId: string) => void;
  assistantId?: string;
  selectedModel?: ChatModel | null;
  attachedFiles: FileUploadItem[];
  setAttachedFiles: (files: FileUploadItem[]) => void;
};

function isAudioTranscriptionAttachment(file: FileUploadItem): boolean {
  return Boolean(file.audio_transcription);
}

function validateCanonicalWavBytes(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const readAscii = (offset: number, length: number) =>
    Array.from(bytes.slice(offset, offset + length))
      .map((byte) => String.fromCharCode(byte))
      .join("");

  if (
    bytes.length < CANONICAL_AUDIO_WAV_HEADER_BYTES ||
    readAscii(0, 4) !== "RIFF" ||
    readAscii(8, 4) !== "WAVE" ||
    readAscii(12, 4) !== "fmt " ||
    readAscii(36, 4) !== "data"
  ) {
    throw new Error(t`Audio recording must be a canonical WAV file.`);
  }

  const dataLength = view.getUint32(40, true);
  if (
    view.getUint32(16, true) !== 16 ||
    view.getUint16(20, true) !== 1 ||
    view.getUint16(22, true) !== 1 ||
    view.getUint32(24, true) !== CANONICAL_AUDIO_SAMPLE_RATE_HZ ||
    view.getUint16(34, true) !== 16 ||
    bytes.length !== CANONICAL_AUDIO_WAV_HEADER_BYTES + dataLength
  ) {
    throw new Error(t`Audio recording must be mono 16-bit PCM WAV at 16 kHz.`);
  }
}

async function splitCanonicalWavForTranscription(
  audioFile: File,
  chunkDurationMs: number,
): Promise<AudioTranscriptionChunk[]> {
  const bytes = new Uint8Array(await audioFile.arrayBuffer());
  validateCanonicalWavBytes(bytes);
  const pcmBytes = bytes.slice(CANONICAL_AUDIO_WAV_HEADER_BYTES);
  const bytesPerMs =
    (CANONICAL_AUDIO_SAMPLE_RATE_HZ * CANONICAL_AUDIO_BYTES_PER_SAMPLE) / 1000;
  const rawChunkBytes = Math.max(
    CANONICAL_AUDIO_BYTES_PER_SAMPLE,
    Math.floor(chunkDurationMs * bytesPerMs),
  );
  const alignedChunkBytes =
    rawChunkBytes - (rawChunkBytes % CANONICAL_AUDIO_BYTES_PER_SAMPLE);
  const chunks: AudioTranscriptionChunk[] = [];

  for (
    let pcmOffset = 0, chunkIndex = 0;
    pcmOffset < pcmBytes.length;
    pcmOffset += alignedChunkBytes, chunkIndex += 1
  ) {
    const nextOffset = Math.min(pcmOffset + alignedChunkBytes, pcmBytes.length);
    const chunkPcmBytes = pcmBytes.slice(pcmOffset, nextOffset);
    const isFirstChunk = chunkIndex === 0;

    chunks.push({
      index: chunkIndex,
      startMs: Math.floor(pcmOffset / bytesPerMs),
      endMs: Math.ceil(nextOffset / bytesPerMs),
      contentType: isFirstChunk ? "audio/wav" : "audio/pcm",
      bytes: isFirstChunk
        ? createCanonicalWavBytesFromPcm(chunkPcmBytes)
        : chunkPcmBytes,
    });
  }

  return chunks;
}

function createAudioTranscriptionWebSocketUrl(): string {
  const url = new URL(
    "/api/v1beta/me/files/audio-transcriptions/socket",
    window.location.href,
  );
  url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function sendAudioTranscriptionControlFrame(
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
      () => reject(new Error(t`Audio transcription connection failed.`)),
      { once: true },
    );
  });
}

function waitForAudioTranscriptionFrame(
  socket: WebSocket,
  predicate: (frame: AudioTranscriptionSocketFrame) => boolean,
): Promise<AudioTranscriptionSocketFrame> {
  return new Promise<AudioTranscriptionSocketFrame>((resolve, reject) => {
    // A clean server/proxy close fires only "close" (no "error"), and a
    // socket that died mid-recording is already CLOSED by the time the
    // finalization attaches listeners — both would otherwise leave this
    // promise (and the stop finalization awaiting it) hanging forever.
    if (
      socket.readyState === WebSocket.CLOSING ||
      socket.readyState === WebSocket.CLOSED
    ) {
      reject(new Error(t`Audio transcription connection closed unexpectedly.`));
      return;
    }

    const handleMessage = (event: MessageEvent) => {
      if (typeof event.data !== "string") {
        return;
      }

      try {
        const frame = JSON.parse(event.data) as AudioTranscriptionSocketFrame;
        if (frame.type === "error") {
          cleanup();
          reject(new Error(frame.error ?? t`Audio transcription failed.`));
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
            : new Error(t`Could not read audio transcription response.`),
        );
      }
    };

    const handleError = () => {
      cleanup();
      reject(new Error(t`Audio transcription connection failed.`));
    };

    const handleClose = () => {
      cleanup();
      reject(new Error(t`Audio transcription connection closed unexpectedly.`));
    };

    const cleanup = () => {
      socket.removeEventListener("message", handleMessage);
      socket.removeEventListener("error", handleError);
      socket.removeEventListener("close", handleClose);
    };

    socket.addEventListener("message", handleMessage);
    socket.addEventListener("error", handleError);
    socket.addEventListener("close", handleClose);
  });
}

function concatUint8Arrays(parts: Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((total, part) => total + part.length, 0);
  const bytes = new Uint8Array(totalLength);
  let offset = 0;

  parts.forEach((part) => {
    bytes.set(part, offset);
    offset += part.length;
  });

  return bytes;
}

function mediaTrackSettingsToDiagnostics(
  settings: MediaTrackSettings,
): AudioRecordingDiagnostics {
  return {
    channelCount: settings.channelCount,
    sampleRate: settings.sampleRate,
    echoCancellation: settings.echoCancellation,
    noiseSuppression: settings.noiseSuppression,
    autoGainControl: settings.autoGainControl,
  };
}

export function formatAudioRecordingDiagnostics(
  diagnostics: AudioRecordingDiagnostics,
): string {
  const channelCount = diagnostics.channelCount;
  const sampleRate = diagnostics.sampleRate;
  const echoCancellation = diagnostics.echoCancellation ? "on" : "off";
  const noiseSuppression = diagnostics.noiseSuppression ? "on" : "off";
  const autoGainControl = diagnostics.autoGainControl ? "on" : "off";
  const values = [
    channelCount ? t`channels: ${channelCount}` : null,
    sampleRate ? t`sample rate: ${sampleRate} Hz` : null,
    diagnostics.echoCancellation !== undefined
      ? t`echo cancellation: ${echoCancellation}`
      : null,
    diagnostics.noiseSuppression !== undefined
      ? t`noise suppression: ${noiseSuppression}`
      : null,
    diagnostics.autoGainControl !== undefined
      ? t`auto gain: ${autoGainControl}`
      : null,
  ].filter((value): value is string => Boolean(value));

  return values.join(" · ");
}

export function useAudioTranscriptionRecorder({
  audioTranscriptionEnabled,
  uploadEnabled,
  maxRecordingDurationSeconds,
  vadAutoStopEnabled = false,
  onVadAutoStop,
  chatId,
  silentChatId,
  setSilentChatId,
  assistantId,
  selectedModel,
  attachedFiles,
  setAttachedFiles,
}: UseAudioTranscriptionRecorderOptions) {
  const [isRecording, setIsRecording] = useState(false);
  /**
   * True once the worklet has delivered the first non-zero sample —
   * the mic is really live, as opposed to streaming OS warm-up zeros.
   * Drives the UI "speak now" cue; mirrors useAudioDictationRecorder.
   */
  const [isCapturingAudio, setIsCapturingAudio] = useState(false);
  const [isRecordingUpload, setIsRecordingUpload] = useState(false);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [retryingAudioFileId, setRetryingAudioFileId] = useState<string | null>(
    null,
  );
  const [recordingBars, setRecordingBars] = useState<number[]>(
    Array.from({ length: AUDIO_BARS_COUNT }, () => 2),
  );
  // The analyser RAF tick fires at ~60 Hz. Throttle setRecordingBars to
  // ~30 Hz (33 ms) so consumer re-renders halve without a perceptible
  // change in the waveform animation. Resets and idle states still go
  // through the raw setter so they apply immediately.
  const setRecordingBarsThrottled = useThrottledCallback(setRecordingBars, 33);
  const [recordingDiagnostics, setRecordingDiagnostics] =
    useState<AudioRecordingDiagnostics | null>(null);
  const [isVadListening, setIsVadListening] = useState(false);
  const [isVadSpeechActive, setIsVadSpeechActive] = useState(false);

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const liveSessionRef = useRef<LiveAudioTranscriptionSession | null>(null);
  const recordedAudioFilesRef = useRef(new Map<string, File>());
  const attachedFilesRef = useRef(attachedFiles);
  /**
   * Pre-session sample buffer: holds Float32 samples captured between
   * the worklet's first frame and the live session being ready, so the
   * user's first words aren't dropped during the chat-create + socket
   * handshake. Mirrors useAudioDictationRecorder (ERMAIN-334).
   */
  const preSessionSamplesRef = useRef<number[]>([]);
  /**
   * AudioContext persists across recordings (suspend between sessions,
   * close only on unmount) and the worklet module registers once per
   * context — both mirror useAudioDictationRecorder.
   */
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletModuleLoadedRef = useRef(false);
  const audioAnalyserRef = useRef<AnalyserNode | null>(null);
  const audioSourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioProcessorRef = useRef<AudioWorkletNode | null>(null);
  const audioLevelDataRef = useRef<Uint8Array | null>(null);
  const audioFrameRef = useRef<number | null>(null);
  /** Per-recording speech-onset controller (detector + deferred-flip
   *  timer); disposed on teardown. */
  const onsetControllerRef = useRef<SpeechOnsetController | null>(null);
  const startInFlightRef = useRef(false);
  const vadEngineRef = useRef<VoiceVadEngine | null>(null);
  const vadAutoStopTriggeredRef = useRef(false);
  const vadDebugLastFrameLogAtRef = useRef(0);
  const vadDebugProcessedFrameCountRef = useRef(0);
  const onVadAutoStopRef = useRef(onVadAutoStop);
  const recordingDurationTimerRef = useRef<number | null>(null);
  const createChatMutation = useCreateChat();
  const { fetcherOptions: fileFetchOptions } = useV1betaApiContext();
  const fileFetchOptionsRef = useRef(fileFetchOptions);
  /** Mounted getter for the awaits in startAudioRecording and the
   *  deferred finalization — mirrors useAudioDictationRecorder. */
  const isMounted = useMountedState();
  const { selectedAudioInputDeviceId, setSelectedAudioInputDeviceId } =
    useAudioInputDevicePreference();

  /**
   * Capture-track device-loss watchdog (ERMAIN-390). Delegated through a
   * ref because the real handler stops recording, which is defined further
   * down — the ref keeps `watchTrack`/`unwatchTrack` available to the early
   * teardown helpers while the handler is wired in an effect below.
   */
  const captureTrackLostHandlerRef = useRef<(reason: TrackLossReason) => void>(
    () => {},
  );
  const { watchTrack: watchCaptureTrack, unwatchTrack: unwatchCaptureTrack } =
    useMediaStreamTrackWatchdog({
      onTrackLost: useCallback((reason: TrackLossReason) => {
        captureTrackLostHandlerRef.current(reason);
      }, []),
    });

  useEffect(() => {
    fileFetchOptionsRef.current = fileFetchOptions;
  }, [fileFetchOptions]);

  useEffect(() => {
    onVadAutoStopRef.current = onVadAutoStop;
  }, [onVadAutoStop]);

  useEffect(() => {
    attachedFilesRef.current = attachedFiles;
  }, [attachedFiles]);

  const upsertAudioTranscriptionAttachment = useCallback(
    (file: FileUploadItem, replaceFileId?: string | null) => {
      const nextAttachedFiles = [
        ...attachedFilesRef.current.filter(
          (attachedFile) =>
            attachedFile.id !== file.id &&
            attachedFile.id !== replaceFileId &&
            !isAudioTranscriptionAttachment(attachedFile),
        ),
        file,
      ];
      attachedFilesRef.current = nextAttachedFiles;
      setAttachedFiles(nextAttachedFiles);
    },
    [setAttachedFiles],
  );

  const updateAudioTranscriptionAttachment = useCallback(
    (fileUploadId: string, audioTranscription: AudioTranscriptionMetadata) => {
      if (
        !attachedFilesRef.current.some(
          (attachedFile) => attachedFile.id === fileUploadId,
        )
      ) {
        return;
      }

      const nextAttachedFiles = attachedFilesRef.current.map((attachedFile) =>
        attachedFile.id === fileUploadId
          ? {
              ...attachedFile,
              audio_transcription: audioTranscription,
            }
          : attachedFile,
      );
      attachedFilesRef.current = nextAttachedFiles;
      setAttachedFiles(nextAttachedFiles);
    },
    [setAttachedFiles],
  );

  const removeAudioTranscriptionAttachment = useCallback(
    (fileUploadId: string) => {
      const nextAttachedFiles = attachedFilesRef.current.filter(
        (attachedFile) => attachedFile.id !== fileUploadId,
      );
      attachedFilesRef.current = nextAttachedFiles;
      setAttachedFiles([...nextAttachedFiles]);
    },
    [setAttachedFiles],
  );

  const stopRecordingVisualizer = useCallback(() => {
    onsetControllerRef.current?.dispose();
    onsetControllerRef.current = null;
    if (audioFrameRef.current !== null) {
      window.cancelAnimationFrame(audioFrameRef.current);
      audioFrameRef.current = null;
    }

    audioAnalyserRef.current?.disconnect();
    audioAnalyserRef.current = null;
    audioSourceNodeRef.current?.disconnect();
    audioSourceNodeRef.current = null;
    if (audioProcessorRef.current) {
      audioProcessorRef.current.port.onmessage = null;
      audioProcessorRef.current.disconnect();
      audioProcessorRef.current = null;
    }
    audioLevelDataRef.current = null;

    // Suspend rather than close: each recording gets fresh source /
    // analyser / worklet nodes, but the AudioContext itself, its audio
    // rendering thread, and the registered worklet module stay warm.
    // Closing + re-creating the context paid an audio-thread spin-up
    // cost on every restart. Close only happens on unmount.
    if (audioContextRef.current?.state === "running") {
      void audioContextRef.current.suspend();
    }
    preSessionSamplesRef.current = [];
    setIsCapturingAudio(false);
    // Drop any pending throttled bar updates before resetting to the idle
    // pattern, so a stale RAF frame can't overwrite the reset.
    setRecordingBarsThrottled.cancel();
    setRecordingBars(Array.from({ length: AUDIO_BARS_COUNT }, () => 2));
  }, [setRecordingBarsThrottled]);

  const clearRecordingDurationTimer = useCallback(() => {
    if (recordingDurationTimerRef.current !== null) {
      window.clearTimeout(recordingDurationTimerRef.current);
      recordingDurationTimerRef.current = null;
    }
  }, []);

  const stopVadEngine = useCallback(() => {
    const hadVadEngine = Boolean(vadEngineRef.current);
    vadEngineRef.current?.destroy();
    vadEngineRef.current = null;
    vadAutoStopTriggeredRef.current = false;
    vadDebugLastFrameLogAtRef.current = 0;
    vadDebugProcessedFrameCountRef.current = 0;
    setIsVadListening(false);
    setIsVadSpeechActive(false);
    if (hadVadEngine) {
      logger.log("VAD engine stopped");
    }
  }, []);

  const stopMediaRecordingStream = useCallback(() => {
    clearRecordingDurationTimer();
    stopVadEngine();
    // Detach the device-loss listeners before stopping the track. Our own
    // `track.stop()` does not fire `ended`, but a `mute` grace timer may be
    // pending — cancel it so an intentional teardown can't surface a
    // spurious post-stop "muted" loss.
    unwatchCaptureTrack();

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    stopRecordingVisualizer();
  }, [
    clearRecordingDurationTimer,
    stopRecordingVisualizer,
    stopVadEngine,
    unwatchCaptureTrack,
  ]);

  const { attachStateChangeListener } = useAudioContextInterruptionRecovery({
    audioContextRef,
    audioProcessorRef,
  });

  /**
   * Returns a ready-to-use AudioContext with the shared dictation
   * worklet module registered and the context in the `running` state.
   * Reuses the existing context across recordings (resume) and creates
   * a fresh one only when the previous one was closed. Returns `null`
   * when the host browser doesn't support Web Audio / AudioWorkletNode.
   * Mirrors useAudioDictationRecorder.ensureAudioContextReady.
   */
  const ensureAudioContextReady = useCallback(
    async (preferredSampleRate?: number): Promise<AudioContext | null> => {
      if (
        typeof AudioContext === "undefined" ||
        typeof AudioWorkletNode === "undefined"
      ) {
        return null;
      }

      let audioContext = audioContextRef.current;
      if (!audioContext || audioContext.state === "closed") {
        try {
          audioContext = preferredSampleRate
            ? new AudioContext({ sampleRate: preferredSampleRate })
            : new AudioContext();
        } catch {
          // Browser refused the requested sample rate; fall back to the
          // default rate — the PCM resampler handles 16 kHz either way.
          audioContext = new AudioContext();
        }
        audioContextRef.current = audioContext;
        workletModuleLoadedRef.current = false;
        // On WebKit, recover from mid-session interruptions. No-op on
        // engines that auto-resume; idempotent + cleaned up on unmount.
        attachStateChangeListener(audioContext);
      }

      if (!workletModuleLoadedRef.current) {
        await audioContext.audioWorklet.addModule(audioDictationWorkletUrl);
        workletModuleLoadedRef.current = true;
      }

      // resume() is a no-op when already running; it matters when
      // reusing a context suspended at the end of the prior recording,
      // and on hosts where a fresh context starts suspended (embedded
      // webviews / lapsed user activation). The transcription recorder
      // previously never resumed, which silently produced zero capture
      // on suspended-start hosts (ERMAIN-334).
      try {
        await audioContext.resume();
      } catch {
        // Resume can reject when user activation has fully expired; the
        // context still works once the source is connected.
      }

      return audioContext;
    },
    [attachStateChangeListener],
  );

  const startLiveAudioTranscriptionSession = useCallback(
    async (
      filename: string,
      sourceSampleRate: number,
    ): Promise<LiveAudioTranscriptionSession> => {
      if (!audioTranscriptionEnabled) {
        throw new Error(
          t`Audio transcription is not available in this environment.`,
        );
      }

      setIsRecordingUpload(true);
      setRecordingError(null);

      const uploadChatId =
        chatId ??
        silentChatId ??
        (
          await createChatMutation.mutateAsync({
            body: {
              ...(assistantId ? { assistant_id: assistantId } : {}),
              ...(selectedModel?.chat_provider_id
                ? { chat_provider_id: selectedModel.chat_provider_id }
                : {}),
            },
          })
        ).chat_id;
      if (!chatId && !silentChatId) {
        setSilentChatId(uploadChatId);
      }

      const socket = new WebSocket(createAudioTranscriptionWebSocketUrl());
      socket.binaryType = "arraybuffer";

      socket.addEventListener("message", (event) => {
        if (typeof event.data !== "string") {
          return;
        }

        try {
          const frame = JSON.parse(event.data) as AudioTranscriptionSocketFrame;
          if ("audio_transcription" in frame && frame.audio_transcription) {
            updateAudioTranscriptionAttachment(
              frame.file_upload_id,
              frame.audio_transcription,
            );
          }
          if (frame.type === "error") {
            setRecordingError(frame.error ?? t`Audio transcription failed.`);
          }
        } catch {
          setRecordingError(t`Could not read audio transcription response.`);
        }
      });

      socket.addEventListener("error", () => {
        setRecordingError(t`Audio transcription connection failed.`);
      });

      try {
        await waitForSocketOpen(socket);
        const sessionStatePromise = waitForAudioTranscriptionFrame(
          socket,
          (frame) => frame.type === "session_state",
        );

        sendAudioTranscriptionControlFrame(socket, {
          type: "start",
          chat_id: uploadChatId,
          filename,
          content_type: "audio/wav",
        });

        const sessionFrame = await sessionStatePromise;
        if (sessionFrame.type !== "session_state") {
          throw new Error(t`Audio transcription did not start.`);
        }

        const initialFile = await fetchGetFile({
          ...fileFetchOptionsRef.current,
          pathParams: { fileId: sessionFrame.file_upload_id },
        });
        upsertAudioTranscriptionAttachment(initialFile);

        // The caller drains the pre-session sample buffer into this
        // session and only then publishes it to liveSessionRef — the
        // drain → ref-assign → flush sequence must stay one synchronous
        // block there so no audio frame can interleave.
        const session: LiveAudioTranscriptionSession = {
          socket,
          fileUploadId: sessionFrame.file_upload_id,
          filename,
          chunkDurationMs:
            sessionFrame.chunk_duration_ms ??
            DEFAULT_AUDIO_TRANSCRIPTION_CHUNK_DURATION_MS,
          nextChunkIndex: sessionFrame.next_chunk_index ?? 0,
          startedAtMs: Date.now(),
          sendQueue: Promise.resolve(),
          pcmParts: [],
          pendingSourceSamples: [],
          sourceSampleRate,
          queuedPcmBytes: 0,
        };
        setIsRecordingUpload(false);
        return session;
      } catch (error) {
        // The session was never published to liveSessionRef, so the
        // socket would otherwise leak on handshake failure.
        socket.close();
        throw error;
      }
    },
    [
      assistantId,
      audioTranscriptionEnabled,
      chatId,
      createChatMutation,
      selectedModel?.chat_provider_id,
      setSilentChatId,
      silentChatId,
      updateAudioTranscriptionAttachment,
      upsertAudioTranscriptionAttachment,
    ],
  );

  const sendLivePcmChunk = useCallback(
    (session: LiveAudioTranscriptionSession, pcmBytes: Uint8Array) => {
      if (pcmBytes.length === 0) {
        return;
      }

      // Clamp the cumulative recording to the configured maximum: the
      // 300ms primer plus the pre-handshake capture push a recording
      // that runs to the cap slightly past the backend's strict
      // duration/byte limits, which would reject the FINAL chunk (the
      // end of the user's speech) and break the retry path. Trimming
      // the overflow client-side keeps the last chunk's end_ms exactly
      // at the limit.
      const maxSessionPcmBytes =
        Math.floor(
          maxRecordingDurationSeconds * CANONICAL_AUDIO_SAMPLE_RATE_HZ,
        ) * CANONICAL_AUDIO_BYTES_PER_SAMPLE;
      const remainingPcmBytes = maxSessionPcmBytes - session.queuedPcmBytes;
      if (remainingPcmBytes <= 0) {
        return;
      }
      const boundedPcmBytes =
        pcmBytes.length > remainingPcmBytes
          ? pcmBytes.slice(
              0,
              remainingPcmBytes -
                (remainingPcmBytes % CANONICAL_AUDIO_BYTES_PER_SAMPLE),
            )
          : pcmBytes;
      if (boundedPcmBytes.length === 0) {
        return;
      }
      session.queuedPcmBytes += boundedPcmBytes.length;

      session.sendQueue = session.sendQueue.then(async () => {
        if (session.socket.readyState !== WebSocket.OPEN) {
          return;
        }

        const chunkIndex = session.nextChunkIndex;
        const startMs = chunkIndex * session.chunkDurationMs;
        const chunkDurationMs = Math.ceil(
          (boundedPcmBytes.length /
            CANONICAL_AUDIO_BYTES_PER_SAMPLE /
            CANONICAL_AUDIO_SAMPLE_RATE_HZ) *
            1000,
        );
        const endMs =
          startMs + Math.min(chunkDurationMs, session.chunkDurationMs);
        const isFirstChunk = chunkIndex === 0;
        const canonicalAudioBytes = isFirstChunk
          ? createCanonicalWavBytesFromPcm(boundedPcmBytes)
          : null;

        session.nextChunkIndex += 1;
        session.pcmParts.push(boundedPcmBytes);

        sendAudioTranscriptionControlFrame(session.socket, {
          type: "chunk_metadata",
          chunk_index: chunkIndex,
          start_ms: startMs,
          end_ms: endMs,
          content_type: isFirstChunk ? "audio/wav" : "audio/pcm",
        });
        session.socket.send(canonicalAudioBytes ?? boundedPcmBytes);
      });
    },
    [maxRecordingDurationSeconds],
  );

  // Takes the session explicitly (rather than reading liveSessionRef) so
  // the deferred stop finalization keeps flushing ITS session even after
  // the ref was cleared at stop time — and so a freshly started
  // recording can never be routed into a dying one.
  const flushLiveAudioSamples = useCallback(
    (session: LiveAudioTranscriptionSession, flushFinalChunk: boolean) => {
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
          session,
          resampleMonoFloat32ToPcm16(sourceSamples, session.sourceSampleRate),
        );
      }
    },
    [sendLivePcmChunk],
  );

  useEffect(() => {
    return () => {
      startInFlightRef.current = false;
      liveSessionRef.current?.socket.close();
      liveSessionRef.current = null;
      stopMediaRecordingStream();
      // stopRecordingVisualizer suspends the AudioContext between
      // recordings; close it for real on unmount so the audio rendering
      // thread and the registered worklet are released.
      if (
        audioContextRef.current &&
        audioContextRef.current.state !== "closed"
      ) {
        void audioContextRef.current.close();
      }
      audioContextRef.current = null;
      workletModuleLoadedRef.current = false;
    };
  }, [stopMediaRecordingStream]);

  const uploadRecordedAudio = useCallback(
    async (audioFile: File, retryForFileId?: string | null) => {
      if (!audioTranscriptionEnabled) {
        setRecordingError(
          t`Audio transcription is not available in this environment.`,
        );
        return undefined;
      }

      setIsRecordingUpload(true);
      setRecordingError(null);
      setRetryingAudioFileId(retryForFileId ?? null);

      let socket: WebSocket | null = null;
      const queuedFrames: AudioTranscriptionSocketFrame[] = [];
      const frameWaiters: {
        predicate: (frame: AudioTranscriptionSocketFrame) => boolean;
        resolve: (frame: AudioTranscriptionSocketFrame) => void;
        reject: (error: Error) => void;
      }[] = [];

      const rejectFrameWaiters = (error: Error) => {
        while (frameWaiters.length > 0) {
          frameWaiters.shift()?.reject(error);
        }
      };

      const queueOrResolveFrame = (frame: AudioTranscriptionSocketFrame) => {
        if (frame.type === "error") {
          rejectFrameWaiters(
            new Error(frame.error ?? t`Audio transcription failed.`),
          );
          return;
        }

        const waiterIndex = frameWaiters.findIndex((waiter) =>
          waiter.predicate(frame),
        );
        if (waiterIndex === -1) {
          queuedFrames.push(frame);
          return;
        }

        const [waiter] = frameWaiters.splice(waiterIndex, 1);
        waiter.resolve(frame);
      };

      const waitForFrame = (
        predicate: (frame: AudioTranscriptionSocketFrame) => boolean,
      ) =>
        new Promise<AudioTranscriptionSocketFrame>((resolve, reject) => {
          const queuedFrameIndex = queuedFrames.findIndex(predicate);
          if (queuedFrameIndex !== -1) {
            const [frame] = queuedFrames.splice(queuedFrameIndex, 1);
            resolve(frame);
            return;
          }

          frameWaiters.push({ predicate, resolve, reject });
        });

      try {
        const uploadChatId =
          chatId ??
          silentChatId ??
          (
            await createChatMutation.mutateAsync({
              body: {
                ...(assistantId ? { assistant_id: assistantId } : {}),
                ...(selectedModel?.chat_provider_id
                  ? { chat_provider_id: selectedModel.chat_provider_id }
                  : {}),
              },
            })
          ).chat_id;
        if (!chatId && !silentChatId) {
          setSilentChatId(uploadChatId);
        }

        socket = new WebSocket(createAudioTranscriptionWebSocketUrl());
        socket.binaryType = "arraybuffer";

        socket.addEventListener("message", (event) => {
          if (typeof event.data !== "string") {
            return;
          }

          try {
            queueOrResolveFrame(JSON.parse(event.data));
          } catch (error) {
            rejectFrameWaiters(
              error instanceof Error
                ? error
                : new Error(t`Could not read audio transcription response.`),
            );
          }
        });

        socket.addEventListener("error", () => {
          rejectFrameWaiters(
            new Error(t`Audio transcription connection failed.`),
          );
        });

        socket.addEventListener("close", () => {
          rejectFrameWaiters(
            new Error(t`Audio transcription connection closed unexpectedly.`),
          );
        });

        await new Promise<void>((resolve, reject) => {
          socket?.addEventListener("open", () => resolve(), { once: true });
          socket?.addEventListener(
            "error",
            () => reject(new Error(t`Audio transcription connection failed.`)),
            { once: true },
          );
        });

        sendAudioTranscriptionControlFrame(socket, {
          type: "start",
          chat_id: uploadChatId,
          filename: audioFile.name,
          content_type: "audio/wav",
        });

        const sessionFrame = await waitForFrame(
          (frame) => frame.type === "session_state",
        );
        if (sessionFrame.type !== "session_state") {
          throw new Error(t`Audio transcription did not start.`);
        }

        const initialFile = await fetchGetFile({
          ...fileFetchOptionsRef.current,
          pathParams: { fileId: sessionFrame.file_upload_id },
        });
        recordedAudioFilesRef.current.set(initialFile.id, audioFile);
        upsertAudioTranscriptionAttachment(initialFile, retryForFileId);

        const chunks = await splitCanonicalWavForTranscription(
          audioFile,
          sessionFrame.chunk_duration_ms ??
            DEFAULT_AUDIO_TRANSCRIPTION_CHUNK_DURATION_MS,
        );

        for (const chunk of chunks) {
          const chunkAck = waitForFrame(
            (frame) =>
              frame.type === "chunk_ack" && frame.chunk_index === chunk.index,
          );
          const chunkCompletion = waitForFrame(
            (frame) =>
              (frame.type === "chunk_transcribed" ||
                frame.type === "chunk_failed") &&
              frame.chunk_index === chunk.index,
          );

          sendAudioTranscriptionControlFrame(socket, {
            type: "chunk_metadata",
            chunk_index: chunk.index,
            start_ms: chunk.startMs,
            end_ms: chunk.endMs,
            content_type: chunk.contentType,
          });
          socket.send(chunk.bytes);

          await chunkAck;
          const completedChunkFrame = await chunkCompletion;
          if (completedChunkFrame.type === "chunk_failed") {
            throw new Error(
              completedChunkFrame.error ?? t`Audio transcription chunk failed.`,
            );
          }

          const refreshedFile = await fetchGetFile({
            ...fileFetchOptionsRef.current,
            pathParams: { fileId: sessionFrame.file_upload_id },
          });
          upsertAudioTranscriptionAttachment(refreshedFile, retryForFileId);
        }

        const completedFrame = waitForFrame(
          (frame) => frame.type === "completed",
        );
        sendAudioTranscriptionControlFrame(socket, {
          type: "finish",
        });
        await completedFrame;

        const uploadedFile = await fetchGetFile({
          ...fileFetchOptionsRef.current,
          pathParams: { fileId: sessionFrame.file_upload_id },
        });
        if (retryForFileId) {
          recordedAudioFilesRef.current.delete(retryForFileId);
        }
        recordedAudioFilesRef.current.set(uploadedFile.id, audioFile);
        upsertAudioTranscriptionAttachment(uploadedFile, retryForFileId);

        return [uploadedFile];
      } catch (error) {
        setRecordingError(
          error instanceof Error
            ? error.message
            : t`Failed to upload audio recording for transcription.`,
        );
        return undefined;
      } finally {
        socket?.close();
        setIsRecordingUpload(false);
        setRetryingAudioFileId(null);
      }
    },
    [
      assistantId,
      audioTranscriptionEnabled,
      chatId,
      createChatMutation,
      selectedModel?.chat_provider_id,
      setSilentChatId,
      silentChatId,
      upsertAudioTranscriptionAttachment,
    ],
  );

  const retryAudioTranscription = useCallback(
    (fileId: string) => {
      const sourceAudioFile = recordedAudioFilesRef.current.get(fileId);
      if (!sourceAudioFile) {
        setRecordingError(
          t`Unable to retry this transcription because the source audio is not available.`,
        );
        return;
      }

      void uploadRecordedAudio(sourceAudioFile, fileId);
    },
    [uploadRecordedAudio],
  );

  /**
   * Deferred completion of a live session after the capture graph is
   * torn down: flush the remaining buffered samples, send `finish`,
   * await the server's `completed` frame, and retain the assembled WAV
   * for retries. Takes the session explicitly — the caller clears
   * liveSessionRef synchronously at stop time, so a recording started
   * while this finalization awaits the server can never be routed into
   * or clobbered by the dying session. Replaces the former
   * MediaRecorder.onstop driver.
   */
  const finalizeLiveTranscriptionSession = useCallback(
    async (session: LiveAudioTranscriptionSession | null) => {
      try {
        if (!session) {
          return;
        }

        flushLiveAudioSamples(session, true);
        await session.sendQueue;

        if (session.pcmParts.length === 0) {
          removeAudioTranscriptionAttachment(session.fileUploadId);
          if (isMounted()) {
            setRecordingError(
              t`No audio was captured. Please try recording again.`,
            );
          }
          return;
        }

        const completedFramePromise = waitForAudioTranscriptionFrame(
          session.socket,
          (frame) => frame.type === "completed",
        );
        sendAudioTranscriptionControlFrame(session.socket, {
          type: "finish",
        });
        await completedFramePromise;

        const audioFile = new File(
          [createCanonicalWavBytesFromPcm(concatUint8Arrays(session.pcmParts))],
          session.filename,
          { type: "audio/wav" },
        );
        recordedAudioFilesRef.current.set(session.fileUploadId, audioFile);
      } catch (error) {
        if (isMounted()) {
          setRecordingError(
            error instanceof Error
              ? error.message
              : t`Failed to upload audio recording for transcription.`,
          );
        }
      } finally {
        session?.socket.close();
      }
    },
    [flushLiveAudioSamples, isMounted, removeAudioTranscriptionAttachment],
  );

  const stopAudioRecording = useCallback(() => {
    // Detach the session BEFORE tearing down: from this point no worklet
    // frame can be routed into the dying session, and a follow-up
    // recording owns the ref exclusively.
    const session = liveSessionRef.current;
    liveSessionRef.current = null;
    setIsRecording(false);
    // Tear the capture graph down (stop tracks, disconnect the worklet,
    // suspend the context), then complete the protocol exchange on
    // whatever was already delivered to the JS side.
    stopMediaRecordingStream();
    void finalizeLiveTranscriptionSession(session);
  }, [finalizeLiveTranscriptionSession, stopMediaRecordingStream]);

  // Wire the watchdog to a clean stop. A genuinely dead capture (`ended`,
  // or a mute outliving the grace window) surfaces an actionable error and
  // finalizes the session on whatever was captured before the mic died —
  // no silent dead capture (ERMAIN-390). Defined here so it can reference
  // `stopAudioRecording`; the watchdog reads it through the delegating ref.
  useEffect(() => {
    captureTrackLostHandlerRef.current = (reason: TrackLossReason) => {
      if (!isMounted()) {
        return;
      }
      setRecordingError(
        reason === "ended"
          ? t`The microphone was disconnected. Please check your microphone and start recording again.`
          : t`The microphone stopped sending audio. Please check your microphone and start recording again.`,
      );
      stopAudioRecording();
    };
  }, [isMounted, stopAudioRecording]);

  const startAudioRecording = useCallback(async () => {
    if (!audioTranscriptionEnabled || !uploadEnabled) {
      setRecordingError(
        t`Recording audio is disabled while uploads are not available.`,
      );
      return;
    }

    const mediaDevices =
      typeof navigator === "undefined"
        ? undefined
        : (navigator as Navigator & { mediaDevices?: MediaDevices })
            .mediaDevices;

    if (typeof mediaDevices?.getUserMedia !== "function") {
      setRecordingError(t`Audio recording is not supported in this browser.`);
      return;
    }

    if (startInFlightRef.current) {
      return;
    }
    startInFlightRef.current = true;

    const baseAudioConstraints: MediaTrackConstraints = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: { ideal: 1 },
      sampleRate: { ideal: CANONICAL_AUDIO_SAMPLE_RATE_HZ },
    };

    try {
      let stream: MediaStream;
      try {
        stream = await mediaDevices.getUserMedia({
          audio: selectedAudioInputDeviceId
            ? {
                deviceId: { exact: selectedAudioInputDeviceId },
                ...baseAudioConstraints,
              }
            : baseAudioConstraints,
        });
      } catch (firstError) {
        // A stored deviceId can go stale between enumeration and
        // getUserMedia (e.g. a Bluetooth disconnect). On
        // OverconstrainedError, retry once with the system-default mic
        // and clear the stale stored id — mirrors the dictation recorder.
        if (
          selectedAudioInputDeviceId &&
          firstError instanceof DOMException &&
          firstError.name === "OverconstrainedError"
        ) {
          stream = await mediaDevices.getUserMedia({
            audio: baseAudioConstraints,
          });
          setSelectedAudioInputDeviceId("");
        } else {
          throw firstError;
        }
      }
      if (!isMounted()) {
        // Unmounted while the permission prompt / device open was
        // pending: the unmount cleanup already ran (and saw a null
        // stream ref), so stop the tracks here or the mic stays hot.
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      mediaStreamRef.current = stream;
      const audioTrack = stream.getAudioTracks()[0];
      // Start watching for mid-session device-loss (AirPods route change,
      // incoming call, unplug) as soon as the track exists (ERMAIN-390).
      watchCaptureTrack(audioTrack);
      const trackSettings = audioTrack.getSettings();
      setRecordingDiagnostics(mediaTrackSettingsToDiagnostics(trackSettings));

      const filename = formatAudioRecordingFilename(new Date());

      // Build the audio pipeline BEFORE the chat-create + socket
      // handshake (the dictation recorder's anti-truncation pattern,
      // ERMAIN-334): once the worklet is connected, samples land in
      // preSessionSamplesRef until the live session is ready, so the
      // words spoken during the handshake are no longer lost. The
      // previous ordering tapped the microphone only after the full
      // handshake resolved, dropping everything spoken until then.
      let sourceSampleRate = CANONICAL_AUDIO_SAMPLE_RATE_HZ;
      const audioContext = await ensureAudioContextReady(
        trackSettings.sampleRate,
      );
      if (!isMounted()) {
        stream.getTracks().forEach((track) => track.stop());
        // The unmount cleanup already closed (and nulled) the previous
        // context, so a context created by the await above would leak.
        if (audioContext && audioContext.state !== "closed") {
          void audioContext.close();
        }
        audioContextRef.current = null;
        return;
      }
      if (audioContext) {
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        const processor = new AudioWorkletNode(
          audioContext,
          AUDIO_TRANSCRIPTION_WORKLET_PROCESSOR_NAME,
        );
        // Match the dictation recorder: time-domain sampling with a
        // 256-sample FFT and a touch of smoothing reads voice energy
        // across the whole window instead of bucketing it into one
        // low-frequency bin, so all five bars react to speech.
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.65;
        sourceSampleRate = audioContext.sampleRate;
        logger.log("Audio worklet connected", {
          sampleRate: audioContext.sampleRate,
          vadAutoStopEnabled,
        });

        // Synthetic silence primer — see useAudioDictationRecorder for
        // the rationale (server-side VAD onset calibration).
        const primerSampleCount = Math.max(
          0,
          Math.floor(
            (audioContext.sampleRate * PRE_SPEECH_SILENCE_PRIMER_MS) / 1000,
          ),
        );
        const primer: number[] = [];
        primer.length = primerSampleCount;
        primer.fill(0);
        preSessionSamplesRef.current = primer;

        // The worklet posts every render quantum, including zero-filled
        // OS warm-up frames — those belong in the stream sent to the
        // server (it stays dumb). The "speak now" UI cue is separate and
        // UI-only: an RMS onset detector flips isCapturingAudio on real
        // speech-level energy. It replaced an exact-zero predicate that
        // mistimed on WebKit's noise-floor warm-up — see
        // useAudioDictationRecorder and onsetDetector (ERMAIN-379).
        const flipCapturingAudio = () => {
          // Guard against late firings after teardown or unmount: the
          // processor ref will be null or point at a different node.
          if (!isMounted() || audioProcessorRef.current !== processor) {
            return;
          }
          setIsCapturingAudio(true);
        };
        const onsetController = createSpeechOnsetController({
          sampleRate: audioContext.sampleRate,
          onFlip: flipCapturingAudio,
          log: (diagnostics) => logger.log("[AUDIO_DICT] frame", diagnostics),
        });
        onsetControllerRef.current = onsetController;
        logger.log("[AUDIO_DICT] onset detector armed", {
          sampleRate: audioContext.sampleRate,
          engine: getAudioEnvironment().engine,
        });
        processor.port.onmessage = (event: MessageEvent<Float32Array>) => {
          const input = event.data;
          const vadFrame = vadEngineRef.current
            ? new Float32Array(input)
            : null;
          onsetController.acceptFrame(input);
          const session = liveSessionRef.current;
          if (session) {
            for (let index = 0; index < input.length; index += 1) {
              session.pendingSourceSamples.push(input[index]);
            }
            flushLiveAudioSamples(session, false);
          } else {
            const preBuffer = preSessionSamplesRef.current;
            for (let index = 0; index < input.length; index += 1) {
              preBuffer.push(input[index]);
            }
          }
          if (vadFrame && vadEngineRef.current) {
            void vadEngineRef.current
              .acceptFrame({
                samples: vadFrame,
                sampleRate: audioContext.sampleRate,
                timestampMs: Date.now(),
              })
              .catch((error) => {
                logger.warn(
                  "VAD frame processing failed; disabling VAD",
                  error,
                );
                stopVadEngine();
              });
          }
        };

        const levelData = new Uint8Array(analyser.fftSize);

        const analyzeLevel = () => {
          if (!audioAnalyserRef.current || !audioLevelDataRef.current) {
            return;
          }

          audioAnalyserRef.current.getByteTimeDomainData(
            audioLevelDataRef.current,
          );

          setRecordingBarsThrottled(
            getAudioLevelBarsFromTimeDomainData(audioLevelDataRef.current),
          );
          audioFrameRef.current = window.requestAnimationFrame(analyzeLevel);
        };

        audioContextRef.current = audioContext;
        audioAnalyserRef.current = analyser;
        audioSourceNodeRef.current = source;
        audioProcessorRef.current = processor;
        audioLevelDataRef.current = levelData;
        source.connect(analyser);
        source.connect(processor);
        audioFrameRef.current = window.requestAnimationFrame(analyzeLevel);
      } else {
        setRecordingBars((existingBars) =>
          existingBars.length === AUDIO_BARS_COUNT
            ? [2, 2, 6, 2, 2]
            : Array.from({ length: AUDIO_BARS_COUNT }, () => 2),
        );
      }

      // The VAD model load below and the session handshake after it no
      // longer gate capture — the connected worklet is already filling
      // the pre-session buffer.
      let vadEngine: VoiceVadEngine | null = null;
      if (vadAutoStopEnabled) {
        const vadOptions = {
          model: "silero-v5" as const,
          redemptionMs: 1800,
          preSpeechPadMs: 500,
          minSpeechMs: 400,
        };
        try {
          logger.log("VAD auto-stop enabled; starting engine", vadOptions);
          vadEngine = createRicky0123VadEngine(vadOptions);
          vadEngine.subscribe((event) => {
            if (event.type === "frame") {
              vadDebugProcessedFrameCountRef.current += 1;
              const now = Date.now();
              if (
                now - vadDebugLastFrameLogAtRef.current >=
                VAD_DEBUG_FRAME_LOG_INTERVAL_MS
              ) {
                vadDebugLastFrameLogAtRef.current = now;
                logger.log("VAD frame probabilities", {
                  framesProcessed: vadDebugProcessedFrameCountRef.current,
                  frameSamples: event.frame.samples.length,
                  sampleRate: event.frame.sampleRate,
                  isSpeech:
                    Math.round(event.probabilities.isSpeech * 1000) / 1000,
                  notSpeech:
                    Math.round(event.probabilities.notSpeech * 1000) / 1000,
                });
              }
              return;
            }
            if (event.type === "error") {
              logger.warn("VAD engine emitted an error", event.error);
              return;
            }
            if (event.type === "speech_start") {
              logger.log("VAD speech_start", {
                timestampMs: event.timestampMs,
              });
              setIsVadSpeechActive(true);
              return;
            }
            if (event.type === "speech_real_start") {
              logger.log("VAD speech_real_start", {
                timestampMs: event.timestampMs,
              });
              setIsVadSpeechActive(true);
              return;
            }
            if (event.type === "vad_misfire") {
              logger.log("VAD misfire; keeping recording open", {
                timestampMs: event.timestampMs,
              });
              setIsVadSpeechActive(false);
              return;
            }

            setIsVadSpeechActive(false);
            if (vadAutoStopTriggeredRef.current) {
              logger.log("VAD speech_end ignored; auto-stop already triggered");
              return;
            }
            logger.log("VAD speech_end; stopping recording and auto-sending", {
              timestampMs: event.timestampMs,
              audioSamples: event.audio.length,
            });
            vadAutoStopTriggeredRef.current = true;
            onVadAutoStopRef.current?.();
            stopAudioRecording();
          });
          await vadEngine.start();
          vadEngineRef.current = vadEngine;
          setIsVadListening(true);
          logger.log("VAD engine listening");
        } catch (error) {
          logger.warn(
            "VAD engine failed to start; continuing without auto-stop",
            error,
          );
          vadEngine?.destroy();
          vadEngineRef.current = null;
          setIsVadListening(false);
          setIsVadSpeechActive(false);
        }
      }

      const liveSession = await startLiveAudioTranscriptionSession(
        filename,
        sourceSampleRate,
      );
      if (!isMounted() || mediaStreamRef.current !== stream) {
        // Unmounted, or the capture graph was torn down (e.g. VAD
        // auto-stop) while the handshake was in flight — don't resurrect
        // a recording on a dead graph.
        liveSession.socket.close();
        return;
      }

      // Drain pre-buffered samples into the new session in their
      // original order, THEN publish the session ref. Order matters:
      // until `liveSessionRef.current` is set, the worklet handler keeps
      // pushing to `preSessionSamplesRef`. The drain → ref-assign →
      // flush sequence is one synchronous block, so no audio frame can
      // interleave and split samples across the two buffers.
      const preBuffer = preSessionSamplesRef.current;
      if (preBuffer.length > 0) {
        for (let index = 0; index < preBuffer.length; index += 1) {
          liveSession.pendingSourceSamples.push(preBuffer[index]);
        }
        preSessionSamplesRef.current = [];
      }
      liveSessionRef.current = liveSession;
      flushLiveAudioSamples(liveSession, false);

      clearRecordingDurationTimer();
      const recordingLimitMs = Math.max(
        1,
        Math.ceil(maxRecordingDurationSeconds),
      );
      recordingDurationTimerRef.current = window.setTimeout(() => {
        stopAudioRecording();
        setRecordingError(
          t`Recording stopped automatically after the configured maximum duration.`,
        );
      }, recordingLimitMs * 1000);
      setIsRecording(true);
      setRecordingError(null);
    } catch (error) {
      liveSessionRef.current?.socket.close();
      liveSessionRef.current = null;
      stopMediaRecordingStream();
      setIsRecording(false);
      setIsRecordingUpload(false);
      // Map the common getUserMedia DOMExceptions to actionable copy instead of
      // leaking raw browser strings (e.g. "Requested device not found"). A
      // NotFoundError here means no microphone is exposed to the page — common
      // inside embedded webviews (e.g. the Office add-in) and when the OS mic
      // privacy setting is off.
      const errorName = error instanceof DOMException ? error.name : undefined;
      if (errorName === "NotAllowedError" || errorName === "SecurityError") {
        setRecordingError(
          t`Microphone permission denied. Allow microphone access and try again.`,
        );
      } else if (
        errorName === "NotFoundError" ||
        errorName === "OverconstrainedError"
      ) {
        setRecordingError(
          t`No microphone is available. Connect or enable a microphone and try again.`,
        );
      } else if (errorName === "NotReadableError") {
        setRecordingError(
          t`The microphone is already in use by another application.`,
        );
      } else {
        setRecordingError(
          error instanceof Error
            ? error.message
            : t`Could not start audio recording.`,
        );
      }
    } finally {
      startInFlightRef.current = false;
    }
  }, [
    audioTranscriptionEnabled,
    uploadEnabled,
    stopMediaRecordingStream,
    maxRecordingDurationSeconds,
    clearRecordingDurationTimer,
    ensureAudioContextReady,
    isMounted,
    stopAudioRecording,
    startLiveAudioTranscriptionSession,
    flushLiveAudioSamples,
    selectedAudioInputDeviceId,
    setSelectedAudioInputDeviceId,
    setRecordingBarsThrottled,
    stopVadEngine,
    vadAutoStopEnabled,
    watchCaptureTrack,
  ]);

  const toggleAudioRecording = useCallback(() => {
    if (!audioTranscriptionEnabled) {
      setRecordingError(t`Audio transcription is not enabled.`);
      return;
    }

    if (isRecording) {
      stopAudioRecording();
      return;
    }

    void startAudioRecording();
  }, [
    audioTranscriptionEnabled,
    isRecording,
    startAudioRecording,
    stopAudioRecording,
  ]);

  const removeRecordedAudioFile = useCallback((fileId: string) => {
    recordedAudioFilesRef.current.delete(fileId);
  }, []);

  const clearRecordedAudioFiles = useCallback(() => {
    recordedAudioFilesRef.current.clear();
  }, []);

  const hasRecordedAudioFile = useCallback(
    (fileId: string) => recordedAudioFilesRef.current.has(fileId),
    [],
  );

  return {
    isRecording,
    isCapturingAudio,
    isRecordingUpload,
    recordingError,
    setRecordingError,
    retryingAudioFileId,
    recordingBars,
    recordingDiagnostics,
    isVadListening,
    isVadSpeechActive,
    toggleAudioRecording,
    retryAudioTranscription,
    removeRecordedAudioFile,
    clearRecordedAudioFiles,
    hasRecordedAudioFile,
  };
}
