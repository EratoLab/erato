import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useMountedState } from "react-use";
import { useThrottledCallback } from "use-debounce";
/* eslint-disable lingui/no-unlocalized-strings */

// `?worker&url` routes the worklet through Vite's worker bundling
// pipeline, which emits it as a hashed JS asset alongside the main
// bundle and returns its URL. The platform-canonical
// `new URL("./worklet.ts", import.meta.url)` pattern does NOT work for
// TS worklets: Vite inlines `.ts` files referenced that way as a
// `data:video/mp2t;base64,…` URL (the `.ts` MIME being MPEG Transport
// Stream video, not TypeScript), which the browser refuses to load via
// `audioWorklet.addModule()`. AudioWorklet and Web Worker modules
// share the same ESM contract on the file format side, so the worker
// pipeline output is valid as an AudioWorklet module.
import {
  createAudioDictationWebSocketUrl,
  sendAudioDictationControlFrame,
  waitForAudioDictationFrame,
  waitForSocketOpen,
  type AudioDictationSocketFrame,
} from "./audio-dictation-protocol";
import audioDictationWorkletUrl from "./audio-dictation-worklet.ts?worker&url";
import {
  AUDIO_BARS_COUNT,
  CANONICAL_AUDIO_BYTES_PER_SAMPLE,
  CANONICAL_AUDIO_SAMPLE_RATE_HZ,
  createCanonicalWavBytesFromPcm,
  getAudioLevelBarsFromTimeDomainData,
  mediaTrackSettingsToDiagnostics,
  resampleMonoFloat32ToPcm16,
  type AudioDictationDiagnostics,
} from "./audio-pcm-codec";
import { useAudioInputDevicePreference } from "./useAudioInputDevicePreference";

const AUDIO_DICTATION_WORKLET_PROCESSOR_NAME = "audio-dictation-processor";

/**
 * Synthetic silence prefix prepended to every dictation session before the
 * captured audio. Mirrors what production streaming-STT VADs require for
 * speech-onset calibration (OpenAI Realtime `prefix_padding_ms` defaults
 * to 300 ms; Silero `speech_pad_ms`, sherpa-onnx pre-speech padding all
 * land in the same range). Without it, the first dictation after browser
 * startup happens to ship hundreds of milliseconds of OS warm-up zeros
 * which double as the VAD calibration window — but a second dictation
 * back-to-back finds the OS audio device still hot, ships near-zero
 * leading silence, and the server's VAD trims the first word.
 */
const PRE_SPEECH_SILENCE_PRIMER_MS = 300;

/**
 * Floor between `source.connect(processor)` and the visible
 * `isCapturingAudio` flip. Belt-and-braces alongside the primer: on a
 * fully-warm audio device the worklet's first non-zero frame can arrive
 * in tens of milliseconds, fast enough that the spinner feels like a
 * blink and the user starts speaking before they've finished the priming
 * breath. Holding the spinner for at least this long gives them a
 * consistent visual rhythm across cold and warm dictations.
 */
const MIN_AUDIO_CAPTURE_DELAY_MS = 150;

const DEFAULT_AUDIO_DICTATION_CHUNK_DURATION_MS = 30_000;

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

type UseAudioDictationRecorderOptions = {
  enabled: boolean;
  maxRecordingDurationSeconds: number;
  onTranscriptChunk: (chunk: AudioDictationTranscriptChunk) => void;
};

/**
 * Session lifecycle as a discriminated union — replaces the previous
 * isDictating / isDictationStarting / isDictationCompleting booleans
 * (which permitted impossible combinations like
 * "starting && completing"). One source of truth, statically
 * mutually-exclusive. The three booleans are still exposed on the
 * hook's return for backward compatibility, derived from this.
 *
 *   idle ──start──▶ starting ──session_ready──▶ dictating
 *    ▲                │                            │
 *    │                │ user_stop (cancel)         │ user_stop
 *    │                ▼                            ▼
 *    └────────────── idle              completing ──complete──▶ idle
 *
 * `abort` resets to idle from any state and is used by error paths.
 * `isCapturingAudio` is orthogonal (audio-graph signal, not session
 * lifecycle) and stays as its own useState.
 */
type DictationSessionStatus =
  | "idle"
  | "starting"
  | "dictating"
  | "completing";

type DictationSessionAction =
  | { type: "start" }
  | { type: "session_ready" }
  | { type: "user_stop" }
  | { type: "complete" }
  | { type: "abort" };

function dictationSessionReducer(
  status: DictationSessionStatus,
  action: DictationSessionAction,
): DictationSessionStatus {
  switch (action.type) {
    case "start":
      return status === "idle" ? "starting" : status;
    case "session_ready":
      return status === "starting" ? "dictating" : status;
    case "user_stop":
      if (status === "dictating") return "completing";
      if (status === "starting") return "idle";
      return status;
    case "complete":
      return status === "completing" ? "idle" : status;
    case "abort":
      return "idle";
  }
}

export function useAudioDictationRecorder({
  enabled,
  maxRecordingDurationSeconds,
  onTranscriptChunk,
}: UseAudioDictationRecorderOptions) {
  const [sessionStatus, dispatchSession] = useReducer(
    dictationSessionReducer,
    "idle",
  );
  const isDictating = sessionStatus === "dictating";
  const isDictationStarting = sessionStatus === "starting";
  const isDictationCompleting = sessionStatus === "completing";
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
  /**
   * The analyser RAF tick fires at ~60 Hz. Throttle setDictationBars to
   * ~30 Hz (33 ms): halves consumer re-renders, no perceptible UX
   * difference, leaves the analyser sampling at full rate for accurate
   * bar values. Used inside the RAF tick only; resets and idle states
   * still go through the raw setter so they apply immediately.
   */
  const setDictationBarsThrottled = useThrottledCallback(
    setDictationBars,
    33,
  );
  const [dictationDiagnostics, setDictationDiagnostics] =
    useState<AudioDictationDiagnostics | null>(null);

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
   * Per-session AbortController. Created at the start of every
   * dictation; aborted on user-stop-during-starting, on error, and on
   * hook unmount. The signal is plumbed through `waitForSocketOpen`
   * and `waitForAudioDictationFrame` so they reject promptly without
   * leaving listeners attached. Replaces the manual close-the-socket
   * dance for cancellation paths.
   */
  const sessionAbortRef = useRef<AbortController | null>(null);
  /**
   * Pre-session sample buffer: holds Float32 samples captured between
   * `processor.onaudioprocess` first firing and the live session being
   * ready. Drained into `session.pendingSourceSamples` once the session
   * resolves, so the user's first words aren't dropped during the socket
   * handshake.
   */
  const preSessionSamplesRef = useRef<number[]>([]);
  /**
   * AudioContext persists across dictation sessions. Each session creates
   * fresh source / analyser / worklet nodes (so leftover per-session
   * state can't leak), but the context itself, its audio rendering
   * thread, and the registered worklet processor stay warm. Closing and
   * re-creating the context on every stop pays an audio-thread spin-up
   * cost on every restart — which is most likely what was eating the
   * first word on a "warm" second dictation.
   */
  const audioContextRef = useRef<AudioContext | null>(null);
  /**
   * Tracks whether `audioWorklet.addModule(audioDictationWorkletUrl)`
   * has been called on the current AudioContext, so we don't re-fetch
   * or re-register on every session start. Reset whenever a fresh
   * AudioContext is created.
   */
  const workletModuleLoadedRef = useRef(false);
  const audioAnalyserRef = useRef<AnalyserNode | null>(null);
  const audioSourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioProcessorRef = useRef<AudioWorkletNode | null>(null);
  const audioLevelDataRef = useRef<Uint8Array | null>(null);
  const audioFrameRef = useRef<number | null>(null);
  /**
   * Timer that defers the `isCapturingAudio` flip when the first non-zero
   * frame arrives sooner than `MIN_AUDIO_CAPTURE_DELAY_MS` after the
   * pipeline was wired. Cleared on any teardown so the deferred flip
   * doesn't fire after the user has already cancelled the session.
   */
  const capturingFlipTimerRef = useRef<number | null>(null);
  const recordingDurationTimerRef = useRef<number | null>(null);
  const onTranscriptChunkRef = useRef(onTranscriptChunk);
  /**
   * `react-use`'s `useMountedState` returns a getter that's `true` while
   * the component is mounted and flips to `false` exactly once during
   * unmount cleanup. Replaces a manual `isMounted() = true/false`
   * pattern; matters across awaits in this hook where the component may
   * unmount between yields and we must avoid `setState` afterwards.
   */
  const isMounted = useMountedState();
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
    if (capturingFlipTimerRef.current !== null) {
      window.clearTimeout(capturingFlipTimerRef.current);
      capturingFlipTimerRef.current = null;
    }
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
    // Discard any pending throttled bar update queued from the final
    // RAF tick — otherwise it can fire after the reset below and
    // briefly flash old levels in the idle button.
    setDictationBarsThrottled.cancel();

    // Suspend rather than close: each dictation gets fresh source /
    // analyser / worklet nodes (so per-session state can't leak), but
    // the AudioContext itself stays warm. Closing + re-creating pays an
    // audio-thread spin-up cost on every restart which is most likely
    // what was eating the first word on a warm second session. Close
    // only happens on the hook's unmount cleanup.
    if (audioContextRef.current && audioContextRef.current.state === "running") {
      void audioContextRef.current.suspend();
    }
    preSessionSamplesRef.current = [];
    if (isMounted()) {
      setIsCapturingAudio(false);
    }
    if (resetBars && isMounted()) {
      setDictationBars(Array.from({ length: AUDIO_BARS_COUNT }, () => 2));
    }
  }, [isMounted, setDictationBarsThrottled]);

  const tearDownCaptureGraph = useCallback(() => {
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

  /**
   * Returns a ready-to-use AudioContext with the dictation worklet
   * module registered and the context in the `running` state. Reuses
   * the existing context across sessions (resume) and falls back to
   * creating a fresh one only when the previous one was closed.
   *
   * `preferredSampleRate` is the MediaStreamTrack's reported sample
   * rate. Passing it to the constructor prevents
   * `createMediaStreamSource` from inserting an internal resampler at
   * the graph level — the worklet's PCM resampler still handles the
   * canonical 16 kHz conversion. Only honored on first creation; a
   * persisted context keeps its original rate even if a subsequent
   * track reports a different one, which is the right tradeoff:
   * the audio thread stays warm and the resampler kicks in only when
   * the device actually changes between sessions.
   *
   * Returns `null` when the host browser doesn't support Web Audio /
   * AudioWorkletNode at all.
   */
  const ensureAudioContextReady = useCallback(
    async (
      preferredSampleRate?: number,
    ): Promise<AudioContext | null> => {
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
          // Browser refused the requested sample rate (e.g. outside
          // its supported range). Fall back to the default rate; the
          // worklet's PCM resampler handles the 16 kHz conversion
          // either way, and an internal Web Audio resampler is
          // tolerable when the only alternative is failing start.
          audioContext = new AudioContext();
        }
        audioContextRef.current = audioContext;
        workletModuleLoadedRef.current = false;
      }

      if (!workletModuleLoadedRef.current) {
        await audioContext.audioWorklet.addModule(audioDictationWorkletUrl);
        workletModuleLoadedRef.current = true;
      }

      // resume() is a no-op when the context is already running; it
      // matters when we're reusing a session-2 context that was
      // suspended at the end of session 1, and on browsers where a
      // freshly-created context starts suspended after user activation
      // has lapsed across the preceding awaits (Mozilla bug 1629478).
      try {
        await audioContext.resume();
      } catch {
        // Resume can reject if user activation has fully expired; the
        // context still works, and the worklet starts producing frames
        // once the source is connected.
      }

      return audioContext;
    }, []);

  const startLiveDictationSession = useCallback(
    async (
      sourceSampleRate: number,
      signal: AbortSignal,
    ): Promise<LiveAudioDictationSession> => {
      if (!enabled) {
        throw new Error(
          t`Audio dictation is not available in this environment.`,
        );
      }

      // status is already "starting" when this protocol helper runs;
      // dispatching "start" again is a no-op in the reducer if we're
      // already in starting, but the explicit call documents the
      // invariant for readers.
      if (isMounted()) {
        dispatchSession({ type: "start" });
      }
      setDictationError(null);

      const socket = new WebSocket(createAudioDictationWebSocketUrl());
      socket.binaryType = "arraybuffer";
      pendingSocketRef.current = socket;
      // Abort during the handshake → close the socket so the protocol
      // helpers' close listeners (or signal listeners) fire promptly
      // and the awaits unwind.
      const handleAbortDuringStartup = () => {
        if (socket.readyState !== WebSocket.CLOSED) {
          socket.close();
        }
      };
      signal.addEventListener("abort", handleAbortDuringStartup, {
        once: true,
      });

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
        await waitForSocketOpen(socket, { signal });
        const sessionStatePromise = waitForAudioDictationFrame(
          socket,
          (frame) => frame.type === "session_state",
          { signal },
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
        signal.removeEventListener("abort", handleAbortDuringStartup);
        pendingSocketRef.current = null;
      }
    },
    [enabled, isMounted],
  );

  const completeDictation = useCallback(async () => {
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
      if (isMounted()) {
        dispatchSession({ type: "complete" });
      }
    }
  }, [flushLiveAudioSamples, isMounted]);

  const stopDictation = useCallback(() => {
    // Active dictation: liveSessionRef is set the instant the session
    // resolves, before the reducer transitions to "dictating", so this
    // is the precise "we are recording right now" signal — more
    // reliable than reading the React status across the same tick.
    if (liveSessionRef.current) {
      clearRecordingDurationTimer();
      if (isMounted()) {
        dispatchSession({ type: "user_stop" });
      }
      tearDownCaptureGraph();
      void completeDictation();
      return;
    }

    // Cancel an in-flight startup: aborting the per-session signal
    // rejects the awaits inside `startLiveDictationSession`, which
    // propagates to the catch block in `startDictation` and runs the
    // full teardown there. The signal listener inside the startup
    // helper also closes the WebSocket as a belt-and-braces.
    if (sessionAbortRef.current) {
      sessionAbortRef.current.abort();
      sessionAbortRef.current = null;
      return;
    }

    dispatchSession({ type: "abort" });
    tearDownCaptureGraph();
  }, [
    clearRecordingDurationTimer,
    completeDictation,
    isMounted,
    tearDownCaptureGraph,
  ]);

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
    dispatchSession({ type: "start" });
    const sessionAbort = new AbortController();
    sessionAbortRef.current = sessionAbort;

    const mediaDevices =
      typeof navigator === "undefined"
        ? undefined
        : (navigator as Navigator & { mediaDevices?: MediaDevices })
            .mediaDevices;

    if (typeof mediaDevices?.getUserMedia !== "function") {
      setDictationError(t`Audio recording is not supported in this browser.`);
      dispatchSession({ type: "abort" });
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
      if (!isMounted()) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      mediaStreamRef.current = stream;
      const audioTrack = stream.getAudioTracks()[0];
      const trackSettings = audioTrack.getSettings();
      setDictationDiagnostics(
        mediaTrackSettingsToDiagnostics(trackSettings),
      );

      // Build the audio pipeline BEFORE awaiting the socket handshake. Once
      // the worklet node is connected, samples land in
      // `preSessionSamplesRef` until the live session is constructed, so
      // the user's first words aren't dropped during the (~250 ms–1 s)
      // socket + session_state handshake. Sample extraction runs on the
      // audio rendering thread via `AudioWorkletNode`, isolated from
      // main-thread contention.
      //
      // Passing the track's sampleRate to the AudioContext constructor
      // (when known and supported) prevents createMediaStreamSource from
      // inserting an internal Web Audio resampler — one fewer documented
      // source of startup latency between getUserMedia and the first
      // sample reaching the worklet.
      let sourceSampleRate = CANONICAL_AUDIO_SAMPLE_RATE_HZ;
      const audioContext = await ensureAudioContextReady(
        trackSettings.sampleRate,
      );
      if (!isMounted()) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      if (audioContext) {
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        const processor = new AudioWorkletNode(
          audioContext,
          AUDIO_DICTATION_WORKLET_PROCESSOR_NAME,
        );
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.65;
        sourceSampleRate = audioContext.sampleRate;
        // Synthetic silence primer: seeds the pre-session buffer with a
        // fixed amount of zero samples so the audio sent to the server
        // always starts with the same calibration window for its VAD,
        // regardless of how warm the OS audio device is. Cold first
        // dictation: hundreds of ms of natural OS warm-up zeros arrive
        // first anyway. Warm second dictation: the OS device stays hot
        // between sessions and real audio arrives nearly instantly — the
        // primer is what prevents the server from clipping the first
        // word in that case.
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
        // OS warm-up frames — we want those in the stream sent to the
        // server too. The "speak now" UI cue should still wait for real
        // audio though, so scan each incoming frame for a non-zero
        // sample and flip the `isCapturingAudio` signal on the first one
        // we see. Production STT clients (Deepgram, AssemblyAI, OpenAI
        // Realtime) send the full stream and rely on server-side prefix
        // padding — see
        // https://developers.openai.com/api/docs/guides/realtime-vad
        // (`prefix_padding_ms`, default 300 ms).
        let audioFlowing = false;
        const pipelineReadyAt = Date.now();
        const flipCapturingAudio = () => {
          // Guard against late firings: if the pipeline was torn down
          // between scheduling and execution, the processor ref will be
          // null or point at a different node — don't flip stale state.
          if (
            !isMounted() ||
            audioProcessorRef.current !== processor
          ) {
            return;
          }
          setIsCapturingAudio(true);
        };
        processor.port.onmessage = (event: MessageEvent<Float32Array>) => {
          const input = event.data;
          if (!audioFlowing) {
            for (let index = 0; index < input.length; index += 1) {
              if (input[index] !== 0) {
                audioFlowing = true;
                const elapsed = Date.now() - pipelineReadyAt;
                const remaining = MIN_AUDIO_CAPTURE_DELAY_MS - elapsed;
                if (remaining > 0) {
                  capturingFlipTimerRef.current = window.setTimeout(() => {
                    capturingFlipTimerRef.current = null;
                    flipCapturingAudio();
                  }, remaining);
                } else {
                  flipCapturingAudio();
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

          setDictationBarsThrottled(
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

      const liveSession = await startLiveDictationSession(
        sourceSampleRate,
        sessionAbort.signal,
      );

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
      dispatchSession({ type: "session_ready" });
      setDictationError(null);
    } catch (error) {
      liveSessionRef.current?.socket.close();
      liveSessionRef.current = null;
      tearDownCaptureGraph();
      if (isMounted()) {
        dispatchSession({ type: "abort" });
        // AbortError is the expected outcome of a user-cancel during
        // starting; don't surface it as a "could not start" message.
        const isAbort =
          error instanceof DOMException && error.name === "AbortError";
        if (!isAbort) {
          setDictationError(
            error instanceof Error
              ? error.message
              : t`Could not start audio dictation.`,
          );
        }
      }
    } finally {
      startInFlightRef.current = false;
      if (sessionAbortRef.current === sessionAbort) {
        sessionAbortRef.current = null;
      }
    }
  }, [
    clearRecordingDurationTimer,
    enabled,
    ensureAudioContextReady,
    flushLiveAudioSamples,
    isDictating,
    isDictationCompleting,
    isDictationStarting,
    isMounted,
    maxRecordingDurationSeconds,
    selectedAudioInputDeviceId,
    setDictationBarsThrottled,
    startLiveDictationSession,
    stopDictation,
    tearDownCaptureGraph,
  ]);

  const toggleDictation = useCallback(() => {
    if (isDictating || isDictationStarting) {
      stopDictation();
      return;
    }

    void startDictation();
  }, [isDictating, isDictationStarting, startDictation, stopDictation]);

  useEffect(() => {
    return () => {
      startInFlightRef.current = false;

      // Abort any in-flight startup; its signal listener closes the
      // pending socket as part of teardown.
      sessionAbortRef.current?.abort();
      sessionAbortRef.current = null;
      liveSessionRef.current?.socket.close();
      liveSessionRef.current = null;
      pendingSocketRef.current = null;
      stopRecordingVisualizer(false);
      // stopRecordingVisualizer suspends the AudioContext between
      // sessions; close it for real on unmount so the audio rendering
      // thread and the registered worklet are released.
      if (
        audioContextRef.current &&
        audioContextRef.current.state !== "closed"
      ) {
        void audioContextRef.current.close();
      }
      audioContextRef.current = null;
      workletModuleLoadedRef.current = false;
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
