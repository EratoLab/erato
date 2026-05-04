import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useRef, useState } from "react";
/* eslint-disable lingui/no-unlocalized-strings */

import {
  fetchGetFile,
  useCreateChat,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { useV1betaApiContext } from "@/lib/generated/v1betaApi/v1betaApiContext";

import { useAudioInputDevicePreference } from "./useAudioInputDevicePreference";

import type {
  AudioTranscriptionMetadata,
  ChatModel,
  FileUploadItem,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const CANONICAL_AUDIO_SAMPLE_RATE_HZ = 16_000;
const CANONICAL_AUDIO_WAV_HEADER_BYTES = 44;
const CANONICAL_AUDIO_BYTES_PER_SAMPLE = 2;
const DEFAULT_AUDIO_TRANSCRIPTION_CHUNK_DURATION_MS = 30_000;
const AUDIO_BARS_COUNT = 5;

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
  chunkDurationMs: number;
  nextChunkIndex: number;
  startedAtMs: number;
  sendQueue: Promise<void>;
  pcmParts: Uint8Array[];
  pendingSourceSamples: number[];
  sourceSampleRate: number;
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

    const cleanup = () => {
      socket.removeEventListener("message", handleMessage);
      socket.removeEventListener("error", handleError);
    };

    socket.addEventListener("message", handleMessage);
    socket.addEventListener("error", handleError);
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
  chatId,
  silentChatId,
  setSilentChatId,
  assistantId,
  selectedModel,
  attachedFiles,
  setAttachedFiles,
}: UseAudioTranscriptionRecorderOptions) {
  const [isRecording, setIsRecording] = useState(false);
  const [isRecordingUpload, setIsRecordingUpload] = useState(false);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [retryingAudioFileId, setRetryingAudioFileId] = useState<string | null>(
    null,
  );
  const [recordingBars, setRecordingBars] = useState<number[]>(
    Array.from({ length: AUDIO_BARS_COUNT }, () => 2),
  );
  const [recordingDiagnostics, setRecordingDiagnostics] =
    useState<AudioRecordingDiagnostics | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaChunksRef = useRef<BlobPart[]>([]);
  const liveSessionRef = useRef<LiveAudioTranscriptionSession | null>(null);
  const recordedAudioFilesRef = useRef(new Map<string, File>());
  const attachedFilesRef = useRef(attachedFiles);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioAnalyserRef = useRef<AnalyserNode | null>(null);
  const audioSourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const audioProcessorSinkRef = useRef<GainNode | null>(null);
  const audioLevelDataRef = useRef<Uint8Array | null>(null);
  const audioFrameRef = useRef<number | null>(null);
  const recordingDurationTimerRef = useRef<number | null>(null);
  const createChatMutation = useCreateChat();
  const { fetcherOptions: fileFetchOptions } = useV1betaApiContext();
  const fileFetchOptionsRef = useRef(fileFetchOptions);
  const { selectedAudioInputDeviceId } = useAudioInputDevicePreference();

  useEffect(() => {
    fileFetchOptionsRef.current = fileFetchOptions;
  }, [fileFetchOptions]);

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
    setRecordingBars(Array.from({ length: AUDIO_BARS_COUNT }, () => 2));
  }, []);

  const clearRecordingDurationTimer = useCallback(() => {
    if (recordingDurationTimerRef.current !== null) {
      window.clearTimeout(recordingDurationTimerRef.current);
      recordingDurationTimerRef.current = null;
    }
  }, []);

  const stopMediaRecordingStream = useCallback(() => {
    clearRecordingDurationTimer();

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    stopRecordingVisualizer();
  }, [clearRecordingDurationTimer, stopRecordingVisualizer]);

  const startLiveAudioTranscriptionSession = useCallback(
    async (filename: string): Promise<LiveAudioTranscriptionSession> => {
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
            } as never,
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

      const session: LiveAudioTranscriptionSession = {
        socket,
        fileUploadId: sessionFrame.file_upload_id,
        chunkDurationMs:
          sessionFrame.chunk_duration_ms ??
          DEFAULT_AUDIO_TRANSCRIPTION_CHUNK_DURATION_MS,
        nextChunkIndex: sessionFrame.next_chunk_index ?? 0,
        startedAtMs: Date.now(),
        sendQueue: Promise.resolve(),
        pcmParts: [],
        pendingSourceSamples: [],
        sourceSampleRate: CANONICAL_AUDIO_SAMPLE_RATE_HZ,
      };
      liveSessionRef.current = session;
      setIsRecordingUpload(false);
      return session;
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
      const canonicalAudioBytes = isFirstChunk
        ? createCanonicalWavBytesFromPcm(pcmBytes)
        : null;

      session.nextChunkIndex += 1;
      session.pcmParts.push(pcmBytes);

      sendAudioTranscriptionControlFrame(session.socket, {
        type: "chunk_metadata",
        chunk_index: chunkIndex,
        start_ms: startMs,
        end_ms: endMs,
        content_type: isFirstChunk ? "audio/wav" : "audio/pcm",
      });
      session.socket.send(canonicalAudioBytes ?? pcmBytes);
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

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.stop();
      }

      liveSessionRef.current?.socket.close();
      liveSessionRef.current = null;
      stopMediaRecordingStream();
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
              } as never,
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

  const stopAudioRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
      return;
    }

    setIsRecording(false);
    stopMediaRecordingStream();
  }, [stopMediaRecordingStream]);

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
      setRecordingDiagnostics(
        mediaTrackSettingsToDiagnostics(audioTrack.getSettings()),
      );

      const filename = formatAudioRecordingFilename(new Date());
      const liveSession = await startLiveAudioTranscriptionSession(filename);

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

          setRecordingBars(nextBars);
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
        setRecordingBars((existingBars) =>
          existingBars.length === AUDIO_BARS_COUNT
            ? [2, 2, 6, 2, 2]
            : Array.from({ length: AUDIO_BARS_COUNT }, () => 2),
        );
      }

      const mediaRecorder = new MediaRecorder(stream);

      mediaChunksRef.current = [];
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          mediaChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        clearRecordingDurationTimer();
        setIsRecording(false);
        stopMediaRecordingStream();
        mediaChunksRef.current = [];

        void (async () => {
          const session = liveSessionRef.current;
          try {
            if (!session) {
              return;
            }

            flushLiveAudioSamples(true);
            await session.sendQueue;

            if (session.pcmParts.length === 0) {
              removeAudioTranscriptionAttachment(session.fileUploadId);
              setRecordingError(
                t`No audio was captured. Please try recording again.`,
              );
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
              [
                createCanonicalWavBytesFromPcm(
                  concatUint8Arrays(session.pcmParts),
                ),
              ],
              filename,
              { type: "audio/wav" },
            );
            recordedAudioFilesRef.current.set(session.fileUploadId, audioFile);
          } catch (error) {
            setRecordingError(
              error instanceof Error
                ? error.message
                : t`Failed to upload audio recording for transcription.`,
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
        setIsRecording(false);
        setIsRecordingUpload(false);
        setRecordingError(
          error instanceof Error
            ? error.message
            : t`Could not complete audio recording.`,
        );
      };

      mediaRecorder.start();
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
      setRecordingError(
        error instanceof Error
          ? error.message
          : t`Could not start audio recording.`,
      );
    }
  }, [
    audioTranscriptionEnabled,
    uploadEnabled,
    stopMediaRecordingStream,
    maxRecordingDurationSeconds,
    clearRecordingDurationTimer,
    stopAudioRecording,
    startLiveAudioTranscriptionSession,
    flushLiveAudioSamples,
    removeAudioTranscriptionAttachment,
    selectedAudioInputDeviceId,
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
    isRecordingUpload,
    recordingError,
    setRecordingError,
    retryingAudioFileId,
    recordingBars,
    recordingDiagnostics,
    toggleAudioRecording,
    retryAudioTranscription,
    removeRecordedAudioFile,
    clearRecordedAudioFiles,
    hasRecordedAudioFile,
  };
}
