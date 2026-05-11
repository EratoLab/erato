import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useRef, useState } from "react";
/* eslint-disable lingui/no-unlocalized-strings */

// `?worker&url` makes Vite bundle the worklet as a standalone ESM asset and
// return its URL. Plain `?url` on a `.ts` file in build mode inlines the
// source as a `data:video/mp2t` URL, which the browser refuses to load via
// `audioWorklet.addModule()`. The bundle output is still loadable in any
// worklet-supporting browser — AudioWorklet and Web Worker modules share
// the same ESM contract on the file format side.
import audioDictationWorkletUrl from "./audio-dictation-worklet.ts?worker&url";
import { useAudioInputDevicePreference } from "./useAudioInputDevicePreference";

const AUDIO_DICTATION_WORKLET_PROCESSOR_NAME = "audio-dictation-processor";

const CANONICAL_AUDIO_SAMPLE_RATE_HZ = 16_000;
const CANONICAL_AUDIO_WAV_HEADER_BYTES = 44;
const CANONICAL_AUDIO_BYTES_PER_SAMPLE = 2;
const DEFAULT_AUDIO_DICTATION_CHUNK_DURATION_MS = 30_000;
const AUDIO_DICTATION_SOCKET_OPEN_TIMEOUT_MS = 15_000;
const AUDIO_DICTATION_SOCKET_FRAME_TIMEOUT_MS = 5 * 60_000;
export const AUDIO_BARS_COUNT = 5;
const AUDIO_BAR_MIN_HEIGHT = 2;
const AUDIO_BAR_MAX_HEIGHT = 16;

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

function waitForSocketOpen(
  socket: WebSocket,
  timeoutMs = AUDIO_DICTATION_SOCKET_OPEN_TIMEOUT_MS,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error(t`Audio dictation connection timed out.`));
    }, timeoutMs);
    const handleOpen = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error(t`Audio dictation connection failed.`));
    };
    const handleClose = () => {
      cleanup();
      reject(new Error(t`Audio dictation connection closed.`));
    };
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      socket.removeEventListener("open", handleOpen);
      socket.removeEventListener("error", handleError);
      socket.removeEventListener("close", handleClose);
    };

    socket.addEventListener("open", handleOpen, { once: true });
    socket.addEventListener("error", handleError, { once: true });
    socket.addEventListener("close", handleClose, { once: true });
  });
}

function waitForAudioDictationFrame(
  socket: WebSocket,
  predicate: (frame: AudioDictationSocketFrame) => boolean,
  timeoutMs = AUDIO_DICTATION_SOCKET_FRAME_TIMEOUT_MS,
): Promise<AudioDictationSocketFrame> {
  return new Promise<AudioDictationSocketFrame>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error(t`Audio dictation response timed out.`));
    }, timeoutMs);

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

    const handleClose = () => {
      cleanup();
      reject(new Error(t`Audio dictation connection closed.`));
    };

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      socket.removeEventListener("message", handleMessage);
      socket.removeEventListener("error", handleError);
      socket.removeEventListener("close", handleClose);
    };

    socket.addEventListener("message", handleMessage);
    socket.addEventListener("error", handleError);
    socket.addEventListener("close", handleClose);
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

export function getAudioLevelBarsFromTimeDomainData(
  audioLevelData: Uint8Array,
): number[] {
  const samplesPerBar = Math.max(
    1,
    Math.floor(audioLevelData.length / AUDIO_BARS_COUNT),
  );

  return Array.from({ length: AUDIO_BARS_COUNT }, (_, barIndex) => {
    const startSample = barIndex * samplesPerBar;
    const endSample =
      barIndex + 1 === AUDIO_BARS_COUNT
        ? audioLevelData.length
        : (barIndex + 1) * samplesPerBar;
    let squaredTotal = 0;
    let peak = 0;

    for (let index = startSample; index < endSample; index++) {
      const centeredSample = (audioLevelData[index] - 128) / 128;
      const absoluteSample = Math.abs(centeredSample);
      squaredTotal += centeredSample * centeredSample;
      peak = Math.max(peak, absoluteSample);
    }

    const sampleCount = Math.max(1, endSample - startSample);
    const rms = Math.sqrt(squaredTotal / sampleCount);
    const amplifiedLevel = Math.min(1, Math.max(rms * 8, peak * 3.5));

    return Math.max(
      AUDIO_BAR_MIN_HEIGHT,
      Math.round(
        AUDIO_BAR_MIN_HEIGHT +
          amplifiedLevel * (AUDIO_BAR_MAX_HEIGHT - AUDIO_BAR_MIN_HEIGHT),
      ),
    );
  });
}

export function useAudioDictationRecorder({
  enabled,
  maxRecordingDurationSeconds,
  onTranscriptChunk,
}: UseAudioDictationRecorderOptions) {
  const [isDictating, setIsDictating] = useState(false);
  const [isDictationStarting, setIsDictationStarting] = useState(false);
  const [isDictationCompleting, setIsDictationCompleting] = useState(false);
  /**
   * True once the audio worklet is connected and the microphone tap is
   * really in the audio graph. Distinct from `isDictationStarting`, which
   * flips at the click and stays true through `getUserMedia` +
   * `addModule` waits during which the pipeline is not yet capturing.
   * Drives whether the UI shows the live waveform vs. a loading spinner —
   * showing bars before this is true would invite users to start speaking
   * into a mic the audio graph hasn't tapped yet.
   */
  const [isCapturingAudio, setIsCapturingAudio] = useState(false);
  const [dictationError, setDictationError] = useState<string | null>(null);
  const [dictationBars, setDictationBars] = useState<number[]>(
    Array.from({ length: AUDIO_BARS_COUNT }, () => 2),
  );
  const [dictationDiagnostics, setDictationDiagnostics] =
    useState<AudioDictationDiagnostics | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const liveSessionRef = useRef<LiveAudioDictationSession | null>(null);
  /**
   * In-flight WebSocket during the start handshake, before the
   * `LiveAudioDictationSession` is fully constructed. Tracked separately so
   * `stopDictation` can cancel a startup that's still waiting on the socket
   * to open or the server to reply with `session_state`.
   */
  const pendingSocketRef = useRef<WebSocket | null>(null);
  /**
   * Pre-session sample buffer: holds Float32 samples captured between
   * `processor.onaudioprocess` first firing and the live session being
   * ready. Drained into `session.pendingSourceSamples` once the session
   * resolves, so the user's first words aren't dropped during the socket
   * handshake.
   */
  const preSessionSamplesRef = useRef<number[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioAnalyserRef = useRef<AnalyserNode | null>(null);
  const audioSourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioProcessorRef = useRef<AudioWorkletNode | null>(null);
  const audioLevelDataRef = useRef<Uint8Array | null>(null);
  const audioFrameRef = useRef<number | null>(null);
  const recordingDurationTimerRef = useRef<number | null>(null);
  const onTranscriptChunkRef = useRef(onTranscriptChunk);
  const isMountedRef = useRef(true);
  const startInFlightRef = useRef(false);
  const { selectedAudioInputDeviceId } = useAudioInputDevicePreference({
    enabled,
  });

  useEffect(() => {
    onTranscriptChunkRef.current = onTranscriptChunk;
  }, [onTranscriptChunk]);

  const clearRecordingDurationTimer = useCallback(() => {
    if (recordingDurationTimerRef.current !== null) {
      window.clearTimeout(recordingDurationTimerRef.current);
      recordingDurationTimerRef.current = null;
    }
  }, []);

  const stopRecordingVisualizer = useCallback((resetBars = true) => {
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

    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      void audioContextRef.current.close();
    }
    audioContextRef.current = null;
    preSessionSamplesRef.current = [];
    if (isMountedRef.current) {
      setIsCapturingAudio(false);
    }
    if (resetBars && isMountedRef.current) {
      setDictationBars(Array.from({ length: AUDIO_BARS_COUNT }, () => 2));
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

  const startLiveDictationSession = useCallback(
    async (sourceSampleRate: number): Promise<LiveAudioDictationSession> => {
      if (!enabled) {
        throw new Error(
          t`Audio dictation is not available in this environment.`,
        );
      }

      if (isMountedRef.current) {
        setIsDictationStarting(true);
      }
      setDictationError(null);

      const socket = new WebSocket(createAudioDictationWebSocketUrl());
      socket.binaryType = "arraybuffer";
      pendingSocketRef.current = socket;

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

      try {
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

        return {
          socket,
          chunkDurationMs:
            sessionFrame.chunk_duration_ms ??
            DEFAULT_AUDIO_DICTATION_CHUNK_DURATION_MS,
          nextChunkIndex: sessionFrame.next_chunk_index ?? 0,
          sendQueue: Promise.resolve(),
          sentPcmBytes: 0,
          pendingSourceSamples: [],
          sourceSampleRate,
        };
      } finally {
        pendingSocketRef.current = null;
      }
    },
    [enabled],
  );

  const stopDictation = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
      return;
    }

    // Cancel an in-flight startup: closing the pending socket rejects the
    // await inside `startLiveDictationSession`, which propagates to the
    // catch block in `startDictation` and runs the full teardown there.
    const pendingSocket = pendingSocketRef.current;
    if (pendingSocket) {
      pendingSocketRef.current = null;
      pendingSocket.close();
      return;
    }

    setIsDictating(false);
    stopMediaRecordingStream();
  }, [stopMediaRecordingStream]);

  const startDictation = useCallback(async () => {
    if (
      startInFlightRef.current ||
      isDictating ||
      isDictationStarting ||
      isDictationCompleting
    ) {
      return;
    }

    if (!enabled) {
      setDictationError(
        t`Audio dictation is not available in this environment.`,
      );
      return;
    }

    startInFlightRef.current = true;
    setIsDictationStarting(true);

    const mediaDevices =
      typeof navigator === "undefined"
        ? undefined
        : (navigator as Navigator & { mediaDevices?: MediaDevices })
            .mediaDevices;

    if (typeof mediaDevices?.getUserMedia !== "function") {
      setDictationError(t`Audio recording is not supported in this browser.`);
      setIsDictationStarting(false);
      startInFlightRef.current = false;
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
      if (!isMountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      mediaStreamRef.current = stream;
      const audioTrack = stream.getAudioTracks()[0];
      setDictationDiagnostics(
        mediaTrackSettingsToDiagnostics(audioTrack.getSettings()),
      );

      // Build the audio pipeline BEFORE awaiting the socket handshake. Once
      // the worklet node is connected, samples land in
      // `preSessionSamplesRef` until the live session is constructed, so
      // the user's first words aren't dropped during the (~250 ms–1 s)
      // socket + session_state handshake. Sample extraction runs on the
      // audio rendering thread via `AudioWorkletNode`, isolated from
      // main-thread contention.
      let sourceSampleRate = CANONICAL_AUDIO_SAMPLE_RATE_HZ;
      if (
        typeof AudioContext !== "undefined" &&
        typeof AudioWorkletNode !== "undefined"
      ) {
        const audioContext = new AudioContext();
        await audioContext.audioWorklet.addModule(audioDictationWorkletUrl);
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- The await may yield to the component's unmount cleanup, which flips isMountedRef.current to false; the linter can't see refs change across awaits.
        if (!isMountedRef.current) {
          void audioContext.close();
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        // The user gesture that started dictation may have lapsed across
        // the `getUserMedia` + `addModule` awaits, in which case the new
        // AudioContext starts suspended and no audio flows through the
        // graph. `resume()` is no-op when already running. Awaiting it
        // matters — Mozilla bug 1629478 measured ~70 empty AudioWorklet
        // render quanta of warm-up without an explicit resume, vs ~10
        // with one, so the first real samples arrive much sooner.
        try {
          await audioContext.resume();
        } catch {
          // Resume can reject if user activation has fully expired; the
          // context still works, and the worklet will start producing
          // frames once the source becomes active, so don't fail start.
        }
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- isMountedRef.current may flip false across the preceding awaits; the linter can't see refs change across awaits.
        if (!isMountedRef.current) {
          void audioContext.close();
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        const processor = new AudioWorkletNode(
          audioContext,
          AUDIO_DICTATION_WORKLET_PROCESSOR_NAME,
        );
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.65;
        sourceSampleRate = audioContext.sampleRate;
        preSessionSamplesRef.current = [];
        // The worklet posts every render quantum, including zero-filled
        // OS warm-up frames — we want those in the stream sent to the
        // server so its VAD has a calibration window. The "speak now" UI
        // cue should still wait for real audio though, so scan each
        // incoming frame for a non-zero sample and flip the
        // `isCapturingAudio` signal on the first one we see. Production
        // STT clients (Deepgram, AssemblyAI, OpenAI Realtime) send the
        // full stream and rely on server-side prefix padding — see
        // https://developers.openai.com/api/docs/guides/realtime-vad
        // (`prefix_padding_ms`, default 300 ms).
        let audioFlowing = false;
        processor.port.onmessage = (event: MessageEvent<Float32Array>) => {
          const input = event.data;
          if (!audioFlowing) {
            for (let index = 0; index < input.length; index += 1) {
              if (input[index] !== 0) {
                audioFlowing = true;
                if (isMountedRef.current) {
                  setIsCapturingAudio(true);
                }
                break;
              }
            }
          }
          const session = liveSessionRef.current;
          if (session) {
            for (let index = 0; index < input.length; index += 1) {
              session.pendingSourceSamples.push(input[index]);
            }
            flushLiveAudioSamples(false);
            return;
          }
          const preBuffer = preSessionSamplesRef.current;
          for (let index = 0; index < input.length; index += 1) {
            preBuffer.push(input[index]);
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

          setDictationBars(
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
        setDictationBars((existingBars) =>
          existingBars.length === AUDIO_BARS_COUNT
            ? [2, 2, 6, 2, 2]
            : Array.from({ length: AUDIO_BARS_COUNT }, () => 2),
        );
      }

      const liveSession = await startLiveDictationSession(sourceSampleRate);

      // Drain pre-buffered samples into the new session in their original
      // order, THEN publish the session ref. Order matters: until
      // `liveSessionRef.current` is set, `processor.onaudioprocess` keeps
      // pushing to `preSessionSamplesRef`. The drain → ref-assign → flush
      // sequence is one synchronous block, so no audio frame can interleave
      // and split samples across the two buffers.
      const preBuffer = preSessionSamplesRef.current;
      if (preBuffer.length > 0) {
        for (let index = 0; index < preBuffer.length; index += 1) {
          liveSession.pendingSourceSamples.push(preBuffer[index]);
        }
        preSessionSamplesRef.current = [];
      }
      liveSessionRef.current = liveSession;
      flushLiveAudioSamples(false);

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.onstop = () => {
        clearRecordingDurationTimer();
        if (isMountedRef.current) {
          setIsDictating(false);
          setIsDictationCompleting(true);
        }
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
            if (isMountedRef.current) {
              setIsDictationCompleting(false);
            }
          }
        })();
      };

      mediaRecorder.onerror = (event: Event) => {
        const error = (event as ErrorEvent).error;
        liveSessionRef.current?.socket.close();
        liveSessionRef.current = null;
        stopMediaRecordingStream();
        if (isMountedRef.current) {
          setIsDictating(false);
          setIsDictationStarting(false);
          setIsDictationCompleting(false);
        }
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
      setIsDictationStarting(false);
      setDictationError(null);
    } catch (error) {
      liveSessionRef.current?.socket.close();
      liveSessionRef.current = null;
      stopMediaRecordingStream();
      if (isMountedRef.current) {
        setIsDictating(false);
        setIsDictationStarting(false);
        setIsDictationCompleting(false);
        setDictationError(
          error instanceof Error
            ? error.message
            : t`Could not start audio dictation.`,
        );
      }
    } finally {
      startInFlightRef.current = false;
    }
  }, [
    clearRecordingDurationTimer,
    enabled,
    flushLiveAudioSamples,
    isDictating,
    isDictationCompleting,
    isDictationStarting,
    maxRecordingDurationSeconds,
    selectedAudioInputDeviceId,
    startLiveDictationSession,
    stopDictation,
    stopMediaRecordingStream,
  ]);

  const toggleDictation = useCallback(() => {
    if (isDictating || isDictationStarting) {
      stopDictation();
      return;
    }

    void startDictation();
  }, [isDictating, isDictationStarting, startDictation, stopDictation]);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      startInFlightRef.current = false;
      const mediaRecorder = mediaRecorderRef.current;
      if (mediaRecorder) {
        mediaRecorder.onstop = null;
        mediaRecorder.onerror = null;
        if (mediaRecorder.state === "recording") {
          mediaRecorder.stop();
        }
        mediaRecorderRef.current = null;
      }

      liveSessionRef.current?.socket.close();
      liveSessionRef.current = null;
      pendingSocketRef.current?.close();
      pendingSocketRef.current = null;
      stopRecordingVisualizer(false);
      clearRecordingDurationTimer();
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }
    };
  }, [clearRecordingDurationTimer, stopRecordingVisualizer]);

  return {
    isDictating,
    isDictationStarting,
    isDictationCompleting,
    isCapturingAudio,
    dictationError,
    setDictationError,
    dictationBars,
    dictationDiagnostics,
    toggleDictation,
  };
}
