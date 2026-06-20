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
import { createRicky0123VadEngine } from "@/lib/voice-runtime";
import { createLogger } from "@/utils/debugLogger";

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

import type { VoiceVadEngine } from "@/lib/voice-runtime";

const AUDIO_DICTATION_WORKLET_PROCESSOR_NAME = "audio-dictation-processor";

// Dev-gated diagnostics (enable with `localStorage.DEBUG = "true"`):
// per-frame `[AUDIO_DICT]` RMS + chosen epsilon. Strip once the onset
// timing is signed off on real devices.
const logger = createLogger("HOOK", "useAudioDictationRecorder");

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

export type AudioDictationMode = "dictation" | "conversational";

type UseAudioDictationRecorderOptions = {
  enabled: boolean;
  mode?: AudioDictationMode;
  maxRecordingDurationSeconds: number;
  onTranscriptChunk: (chunk: AudioDictationTranscriptChunk) => void;
  vadAutoStopEnabled?: boolean;
  onVadAutoStop?: () => void;
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
type DictationSessionStatus = "idle" | "starting" | "dictating" | "completing";

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
  mode = "dictation",
  maxRecordingDurationSeconds,
  onTranscriptChunk,
  vadAutoStopEnabled = false,
  onVadAutoStop,
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
  const setDictationBarsThrottled = useThrottledCallback(setDictationBars, 33);
  const [dictationDiagnostics, setDictationDiagnostics] =
    useState<AudioDictationDiagnostics | null>(null);
  const [isVadListening, setIsVadListening] = useState(false);
  const [isVadSpeechActive, setIsVadSpeechActive] = useState(false);

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
   * Set true immediately before any teardown-initiated socket close —
   * successful completion, user cancel, or unmount. After the server sends
   * `completed` it (or the oauth2-proxy) drops the WebSocket with an unclean
   * 1006 close; WebKit dispatches a JS `error` event for that close while
   * Chromium stays silent, so without this guard a fully successful dictation
   * raises a spurious "connection failed" toast in Safari only. Reset to false
   * whenever a fresh socket is opened, so a genuine mid-session drop is still
   * reported.
   */
  const suppressSocketErrorRef = useRef(false);
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
   * cost on every restart.
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
   * Per-session speech-onset controller (detector + deferred-flip timer).
   * Disposed on any teardown so a pending deferred `isCapturingAudio` flip
   * doesn't fire after the user has already cancelled the session.
   */
  const onsetControllerRef = useRef<SpeechOnsetController | null>(null);
  const recordingDurationTimerRef = useRef<number | null>(null);
  const onTranscriptChunkRef = useRef(onTranscriptChunk);
  const vadEngineRef = useRef<VoiceVadEngine | null>(null);
  /**
   * VAD engine instance kept warm ACROSS dictation sessions. The first
   * `vadEngine.start()` pays a multi-megabyte onnxruntime-web WASM +
   * Silero ONNX model load; the engine supports cheap `stop()` + reset
   * reuse, so we create it once and re-start it per session instead of
   * destroying and re-downloading every conversational turn. Destroyed
   * only in the unmount cleanup. `vadEngineRef` stays the "active and
   * listening" signal consumed by the worklet frame feed.
   */
  const persistentVadEngineRef = useRef<VoiceVadEngine | null>(null);
  /** Per-session VAD listener detach; called on every stop so a reused
   *  engine never fires stale callbacks into a finished session. */
  const vadEngineUnsubscribeRef = useRef<(() => void) | null>(null);
  /**
   * Serializes `vadEngine.start()` calls on the shared engine. A
   * stop-then-restart while the cold model load is still in flight
   * would otherwise run two concurrent `MicVAD.new()` loads inside the
   * same instance and leak one ORT session.
   */
  const vadEngineStartQueueRef = useRef<Promise<void>>(Promise.resolve());
  const vadAutoStopTriggeredRef = useRef(false);
  const onVadAutoStopRef = useRef(onVadAutoStop);
  /**
   * `react-use`'s `useMountedState` returns a getter that's `true` while
   * the component is mounted and flips to `false` exactly once during
   * unmount cleanup. Replaces a manual `isMounted() = true/false`
   * pattern; matters across awaits in this hook where the component may
   * unmount between yields and we must avoid `setState` afterwards.
   */
  const isMounted = useMountedState();
  const startInFlightRef = useRef(false);
  const { selectedAudioInputDeviceId, setSelectedAudioInputDeviceId } =
    useAudioInputDevicePreference({
      enabled,
    });

  /**
   * Capture-track device-loss watchdog (ERMAIN-390). Delegated through a
   * ref because the real handler stops dictation, which is defined further
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
    onTranscriptChunkRef.current = onTranscriptChunk;
  }, [onTranscriptChunk]);

  useEffect(() => {
    onVadAutoStopRef.current = onVadAutoStop;
  }, [onVadAutoStop]);

  const clearRecordingDurationTimer = useCallback(() => {
    if (recordingDurationTimerRef.current !== null) {
      window.clearTimeout(recordingDurationTimerRef.current);
      recordingDurationTimerRef.current = null;
    }
  }, []);

  const stopVadEngine = useCallback(() => {
    vadEngineUnsubscribeRef.current?.();
    vadEngineUnsubscribeRef.current = null;
    // stop() — NOT destroy() — so the loaded WASM/ONNX session stays
    // warm in persistentVadEngineRef for the next dictation turn;
    // re-start is then a cheap state reset instead of a multi-second
    // model reload. destroy() happens only on unmount.
    vadEngineRef.current?.stop();
    vadEngineRef.current = null;
    vadAutoStopTriggeredRef.current = false;
    if (isMounted()) {
      setIsVadListening(false);
      setIsVadSpeechActive(false);
    }
  }, [isMounted]);

  const stopRecordingVisualizer = useCallback(
    (resetBars = true) => {
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
      // Discard any pending throttled bar update queued from the final
      // RAF tick — otherwise it can fire after the reset below and
      // briefly flash old levels in the idle button.
      setDictationBarsThrottled.cancel();

      // Suspend rather than close: each dictation gets fresh source /
      // analyser / worklet nodes (so per-session state can't leak), but
      // the AudioContext itself stays warm. Closing + re-creating pays an
      // audio-thread spin-up cost on every restart. Close only happens on
      // the hook's unmount cleanup.
      if (audioContextRef.current?.state === "running") {
        void audioContextRef.current.suspend();
      }
      preSessionSamplesRef.current = [];
      if (isMounted()) {
        setIsCapturingAudio(false);
      }
      if (resetBars && isMounted()) {
        setDictationBars(Array.from({ length: AUDIO_BARS_COUNT }, () => 2));
      }
    },
    [isMounted, setDictationBarsThrottled],
  );

  const tearDownCaptureGraph = useCallback(() => {
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
  const { attachStateChangeListener } = useAudioContextInterruptionRecovery({
    audioContextRef,
    audioProcessorRef,
  });

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
          // Browser refused the requested sample rate (e.g. outside
          // its supported range). Fall back to the default rate; the
          // worklet's PCM resampler handles the 16 kHz conversion
          // either way, and an internal Web Audio resampler is
          // tolerable when the only alternative is failing start.
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

      // resume() is a no-op when the context is already running; it
      // matters when we're reusing a session-2 context that was
      // suspended at the end of session 1, and on browsers where a
      // freshly-created context starts suspended after user activation
      // has lapsed across the preceding awaits.
      try {
        await audioContext.resume();
      } catch {
        // Resume can reject if user activation has fully expired; the
        // context still works, and the worklet starts producing frames
        // once the source is connected.
      }

      return audioContext;
    },
    [attachStateChangeListener],
  );

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
      // Fresh socket: errors on it are meaningful again until we initiate
      // our own teardown below.
      suppressSocketErrorRef.current = false;
      // Abort during the handshake → close the socket so the protocol
      // helpers' close listeners (or signal listeners) fire promptly
      // and the awaits unwind.
      const handleAbortDuringStartup = () => {
        if (socket.readyState !== WebSocket.CLOSED) {
          suppressSocketErrorRef.current = true;
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
        // A close we initiated (completion / cancel / unmount) is expected —
        // WebKit raises `error` for the server's unclean 1006 close even on a
        // fully successful session. Only surface unsolicited failures.
        if (suppressSocketErrorRef.current) {
          return;
        }
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
          mode,
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
    [enabled, isMounted, mode],
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
      // We initiate this close; its `error`/`close` events are expected and
      // must not raise a toast (see suppressSocketErrorRef).
      suppressSocketErrorRef.current = true;
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

  // Wire the watchdog to a clean stop. A genuinely dead capture (`ended`,
  // or a mute outliving the grace window) surfaces an actionable error and
  // completes the session on whatever was captured before the mic died —
  // no silent dead capture (ERMAIN-390). Defined here so it can reference
  // `stopDictation`; the watchdog reads it through the delegating ref.
  useEffect(() => {
    captureTrackLostHandlerRef.current = (reason: TrackLossReason) => {
      if (!isMounted()) {
        return;
      }
      setDictationError(
        reason === "ended"
          ? t`The microphone was disconnected. Please check your microphone and start dictation again.`
          : t`The microphone stopped sending audio. Please check your microphone and start dictation again.`,
      );
      stopDictation();
    };
  }, [isMounted, stopDictation]);

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
        // Belt-and-braces alongside the auto-clear-on-enumerate logic:
        // even after we've validated the stored deviceId against the
        // enumerated list, a Bluetooth disconnect (or any other device
        // change) can race between enumeration and `getUserMedia`. On
        // OverconstrainedError, retry once with the system-default mic
        // and clear the stale stored id so the dropdown reflects
        // reality and subsequent sessions don't keep hitting it.
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
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      mediaStreamRef.current = stream;
      const audioTrack = stream.getAudioTracks()[0];
      // Start watching for mid-session device-loss (AirPods route change,
      // incoming call, unplug) as soon as the track exists (ERMAIN-390).
      watchCaptureTrack(audioTrack);
      const trackSettings = audioTrack.getSettings();
      setDictationDiagnostics(mediaTrackSettingsToDiagnostics(trackSettings));

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
        // server too (it stays dumb; server-side prefix padding handles
        // onset). The "speak now" UI cue is a separate, UI-only concern:
        // an RMS onset detector flips `isCapturingAudio` on real
        // speech-level energy. It replaced an exact-zero predicate
        // (`sample !== 0`) that mistimed on WebKit, whose raw-capture
        // warm-up emits a noise floor instead of bit-exact zeros. The
        // detector gates ONLY the cue; it never sees or alters streamed
        // bytes.
        const flipCapturingAudio = () => {
          // Guard against late firings: if the pipeline was torn down
          // between scheduling and execution, the processor ref will be
          // null or point at a different node — don't flip stale state.
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
            flushLiveAudioSamples(false);
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
              .catch(() => stopVadEngine());
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

        if (vadAutoStopEnabled) {
          // Start (or re-start) the VAD engine only AFTER the capture
          // graph is connected: samples buffer into preSessionSamplesRef
          // while the model loads, so the first-time onnxruntime WASM +
          // Silero ONNX fetch no longer eats the start of the first
          // utterance (ERMAIN-334). The await therefore delays only the
          // session handshake below, never audio capture. The engine is
          // created once and reused warm across turns.
          const vadEngine =
            persistentVadEngineRef.current ??
            createRicky0123VadEngine({
              model: "silero-v5",
              redemptionMs: 1800,
              preSpeechPadMs: 500,
              minSpeechMs: 400,
            });
          persistentVadEngineRef.current = vadEngine;
          const unsubscribeVad = vadEngine.subscribe((event) => {
            if (event.type === "error") {
              stopVadEngine();
              return;
            }
            if (
              event.type === "speech_start" ||
              event.type === "speech_real_start"
            ) {
              if (isMounted()) {
                setIsVadSpeechActive(true);
              }
              return;
            }
            if (event.type === "vad_misfire") {
              if (isMounted()) {
                setIsVadSpeechActive(false);
              }
              return;
            }
            if (event.type !== "speech_end") {
              return;
            }

            if (isMounted()) {
              setIsVadSpeechActive(false);
            }
            if (vadAutoStopTriggeredRef.current) {
              return;
            }
            vadAutoStopTriggeredRef.current = true;
            onVadAutoStopRef.current?.();
            stopDictation();
          });
          vadEngineUnsubscribeRef.current = unsubscribeVad;
          const vadStartPromise = vadEngineStartQueueRef.current
            .catch(() => undefined)
            .then(() => vadEngine.start());
          vadEngineStartQueueRef.current = vadStartPromise.then(
            () => undefined,
            () => undefined,
          );
          try {
            await vadStartPromise;
            if (audioProcessorRef.current === processor) {
              vadEngineRef.current = vadEngine;
              if (isMounted()) {
                setIsVadListening(true);
              }
            } else {
              // The session was torn down while the model loaded; leave
              // the engine warm but detached. Guard the ref compare so a
              // newer session's subscription is never ripped out.
              unsubscribeVad();
              if (vadEngineUnsubscribeRef.current === unsubscribeVad) {
                vadEngineUnsubscribeRef.current = null;
              }
              vadEngine.stop();
            }
          } catch {
            // Model load failed — continue without auto-stop; the warm
            // instance is retained so the next session can retry.
            unsubscribeVad();
            if (vadEngineUnsubscribeRef.current === unsubscribeVad) {
              vadEngineUnsubscribeRef.current = null;
            }
            if (isMounted()) {
              setIsVadListening(false);
              setIsVadSpeechActive(false);
            }
          }
        }
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
      suppressSocketErrorRef.current = true;
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
    setSelectedAudioInputDeviceId,
    startLiveDictationSession,
    stopDictation,
    stopVadEngine,
    tearDownCaptureGraph,
    vadAutoStopEnabled,
    watchCaptureTrack,
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
      suppressSocketErrorRef.current = true;

      // Abort any in-flight startup; its signal listener closes the
      // pending socket as part of teardown.
      sessionAbortRef.current?.abort();
      sessionAbortRef.current = null;
      liveSessionRef.current?.socket.close();
      liveSessionRef.current = null;
      pendingSocketRef.current = null;
      stopVadEngine();
      // stopVadEngine only stop()s the engine so it stays warm between
      // sessions; on unmount release the ONNX/WASM session for real.
      persistentVadEngineRef.current?.destroy();
      persistentVadEngineRef.current = null;
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
  }, [clearRecordingDurationTimer, stopRecordingVisualizer, stopVadEngine]);

  return {
    isDictating,
    isDictationStarting,
    isDictationCompleting,
    isCapturingAudio,
    dictationError,
    setDictationError,
    dictationBars,
    dictationDiagnostics,
    isVadListening,
    isVadSpeechActive,
    toggleDictation,
  };
}
