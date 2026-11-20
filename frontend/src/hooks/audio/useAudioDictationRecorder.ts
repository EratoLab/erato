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
import { useAudioInputDeviceStore } from "@/state/audioInputDeviceStore";
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
import { requestAudioStream } from "./audioCaptureAccess";
import { getAudioEnvironment } from "./audioEnvironment";
import { describeAudioTranscriptionFailure } from "./audioTranscriptionErrors";
import {
  BEFORE_SPEECH_KEPT_MS,
  DEFAULT_MIN_SPEECH_MS,
  CUT_AT_PAUSE_AFTER_MS,
  HESITATION_CHECK_TIMEOUT_MS,
  MISFIRE_MARGIN_MS,
  PAUSE_FRAMES,
  PRE_SPEECH_SILENCE_PRIMER_MS,
  resolveMinSpeechMs,
  SESSION_RETRY_DELAY_MS,
  SILENT_FRAME_PROBABILITY,
  SPEECH_FRAME_PROBABILITY,
} from "./audioTuning";
import {
  createSpeechOnsetController,
  type SpeechOnsetController,
} from "./onsetFlipController";
import { markSpeechEnded, microphoneOpened } from "./speechEnd";
import {
  overVoiceGate,
  overVoiceStep,
  resolveOverVoiceMinSpeechMs,
  type OverVoiceGate,
} from "./talkOverVoice";
import { useAudioContextInterruptionRecovery } from "./useAudioContextInterruptionRecovery";
import { useMediaStreamTrackWatchdog } from "./useMediaStreamTrackWatchdog";

import type { VoiceVadEngine } from "@/lib/voice-runtime";

const AUDIO_DICTATION_WORKLET_PROCESSOR_NAME = "audio-dictation-processor";

// Dev-gated diagnostics (enable with `localStorage.DEBUG = "true"`):
// per-frame `[AUDIO_DICT]` RMS + chosen epsilon. Strip once the onset
// timing is signed off on real devices.
const logger = createLogger("HOOK", "useAudioDictationRecorder");

const DEFAULT_AUDIO_DICTATION_CHUNK_DURATION_MS = 30_000;
export const DEFAULT_END_OF_TURN_SILENCE_MS = 1800;
// Same range the backend accepts; anything else falls back to the default.
const MIN_END_OF_TURN_SILENCE_MS = 500;
const MAX_END_OF_TURN_SILENCE_MS = 5000;

/**
 * Audio kept while the microphone listens over the voice: enough for the
 * start of the words that stop it, including the detector's own lead-in.
 */
const HELD_AUDIO_MS = 1500;
/** Kept before speech the detector was sure of: its first sounds are softer. */
const SPEECH_LEAD_IN_MS = 500;

type OverVoiceHold = {
  released: "speech" | "voice_ended" | null;
  gate: OverVoiceGate;
  lowered: boolean;
  waiter?: (reason: "speech" | "voice_ended") => void;
};

/** A card's commands are a few words: it answers sooner than a conversation. */
export const DEFAULT_CARD_END_OF_TURN_SILENCE_MS = 1000;

export function resolveEndOfTurnSilenceMs(
  value: number | undefined,
  fallback: number = DEFAULT_END_OF_TURN_SILENCE_MS,
): number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= MIN_END_OF_TURN_SILENCE_MS &&
    value <= MAX_END_OF_TURN_SILENCE_MS
    ? value
    : fallback;
}

/**
 * A conversational recording's wait for speech. Nothing is sent for
 * transcription, and no connection opened, until the voice detector is sure
 * someone speaks; until then only the last moments are kept.
 */
type SpeechGate = {
  /** Speech was heard: the recording transcribes from here on. */
  heard: boolean;
  /** The detector is inside a stretch that may be speech. */
  speaking: boolean;
  /** That stretch has reached the turn's minimum speech. */
  realStarted: boolean;
  /** Older audio was dropped while waiting, the silence primer with it. */
  trimmed: boolean;
  /** Frames in a row the detector heard as silence. */
  quietFrames: number;
  /** Source samples handed to the detector, and judged by it so far. */
  fed: number;
  judged: number;
  /** The detector still loads, or catches up on what was said meanwhile. */
  catchingUp: boolean;
  /** The turn ended in the audio the detector caught up on. */
  endedWhileCatchingUp: boolean;
  /** The turn's words are being checked for hesitation sounds only. */
  checking: boolean;
  /** The turn seemed over again while it was checked. */
  recheck?: boolean;
  /** A sound was rejected in the audio caught up on: trim once it runs. */
  trimAfterCatchUp?: boolean;
  waiter?: () => void;
};

/** What a single recording may tune: a card listens differently from a conversation. */
export type DictationTurn = {
  /** Silence in milliseconds that ends this turn. */
  endOfTurnSilenceMs?: number;
  /** Speech the detector must count before this turn can end. */
  minSpeechMs?: number;
  /**
   * A turn of hesitation sounds only ends like any other. For a card, whose
   * own rules answer "mhm" as listening.
   */
  keepHesitations?: boolean;
};

type LiveAudioDictationSession = {
  socket: WebSocket;
  chunkDurationMs: number;
  nextChunkIndex: number;
  sendQueue: Promise<void>;
  sentPcmBytes: number;
  /** Audio time sent so far: where the next piece starts. */
  sentMs: number;
  /** Each piece's words as they came back; `null` for a piece that failed. */
  transcripts: Map<number, string | null>;
  /** Called whenever a piece's words come back. */
  onTranscript: Set<() => void>;
  /**
   * Words held back from the caller until the turn is over, so a turn of
   * hesitations can be dropped; `null` when they go out at once.
   */
  held: AudioDictationTranscriptChunk[] | null;
  /** Pieces whose words were only hesitations: they go out empty. */
  blanked: Set<number>;
  /** The index of the session's first piece. */
  firstChunkIndex: number;
  pendingSourceSamples: number[];
  sourceSampleRate: number;
};

/**
 * What the detector heard in one recording, for deciding by voice: when it
 * started on the device's clock, and its speech by sample time from there.
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
  /** Silence in milliseconds after which the VAD ends the turn. */
  endOfTurnSilenceMs?: number;
  /** Speech the VAD must count before a turn can end, in milliseconds. */
  minSpeechMs?: number;
  /**
   * The voice speaks. A conversational recording started now listens over
   * it: nothing is sent for transcription and no turn ends until speech
   * over the voice is confirmed, or the voice ends on its own.
   */
  voiceSpeaking?: boolean;
  /** How long speech over the voice must last, in milliseconds. */
  overVoiceMinSpeechMs?: number;
  /** The user talks over the voice; the caller makes it yield. */
  onSpeechOverVoice?: () => void;
  /** Speech over the voice may be starting: lower it, or restore it. */
  onVoiceLowered?: (lowered: boolean) => void;
  /**
   * Whether a conversational turn's words are only hesitation sounds. Such a
   * turn does not end: nothing is sent, and the recording listens on.
   */
  isHesitationOnly?: (words: string) => boolean;
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
  endOfTurnSilenceMs,
  minSpeechMs,
  voiceSpeaking = false,
  overVoiceMinSpeechMs,
  onSpeechOverVoice,
  onVoiceLowered,
  isHesitationOnly,
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
  /** The microphone is open over the voice and waits for speech. */
  const [isListeningOverVoice, setIsListeningOverVoice] = useState(false);
  /**
   * The words of a turn held back as hesitation only: the recording listens
   * on, and the person can be shown why nothing happened.
   */
  const [heldHesitation, setHeldHesitation] = useState<string | null>(null);

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
   * Sockets this hook closed itself: completion, cancel, unmount. After the
   * server sends `completed` it (or the oauth2-proxy) drops the WebSocket with
   * an unclean 1006 close; WebKit dispatches a JS `error` event for that close
   * while Chromium stays silent. Kept per socket, so a newer recording never
   * makes an older socket's errors count again.
   */
  const quietSocketsRef = useRef(new WeakSet<WebSocket>());
  /** The current conversational recording's wait for speech. */
  const gateRef = useRef<SpeechGate | null>(null);
  /** The turn ended while its connection was still opening: finish once open. */
  const finishWhenOpenRef = useRef(false);
  const isHesitationOnlyRef = useRef(isHesitationOnly);
  /** The current turn may not end on hesitation sounds alone. */
  const checkHesitationsRef = useRef(false);
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
  /** Samples dropped from the front of the pre-session buffer this recording. */
  const preDroppedRef = useRef(0);
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
  const voiceSpeakingRef = useRef(voiceSpeaking);
  const overVoiceMinSpeechMsRef = useRef(
    resolveOverVoiceMinSpeechMs(overVoiceMinSpeechMs),
  );
  const onSpeechOverVoiceRef = useRef(onSpeechOverVoice);
  const onVoiceLoweredRef = useRef(onVoiceLowered);
  /** The current recording's wait over the voice, from its start. */
  const holdRef = useRef<OverVoiceHold | null>(null);
  const recordingSignalsRef = useRef<RecordingSignals | null>(null);
  /**
   * `react-use`'s `useMountedState` returns a getter that's `true` while
   * the component is mounted and flips to `false` exactly once during
   * unmount cleanup. Replaces a manual `isMounted() = true/false`
   * pattern; matters across awaits in this hook where the component may
   * unmount between yields and we must avoid `setState` afterwards.
   */
  const isMounted = useMountedState();
  const startInFlightRef = useRef(false);
  const selectedAudioInputDeviceId = useAudioInputDeviceStore(
    (state) => state.selectedDeviceId,
  );

  // Capture-track device-loss watchdog (ERMAIN-390). The inline handler
  // references `stopDictation`, which is defined further down — fine, it's a
  // closure only ever invoked post-render, and the watchdog re-reads the
  // latest one each render via its own Effect Event. No mount guard needed:
  // the watchdog removes all listeners and clears its timers on unmount, so
  // this can't fire after teardown.
  const { watchTrack: watchCaptureTrack, unwatchTrack: unwatchCaptureTrack } =
    useMediaStreamTrackWatchdog({
      onTrackLost: (reason) => {
        setDictationError(
          reason === "ended"
            ? t`The microphone was disconnected. Please check your microphone and start dictation again.`
            : t`The microphone stopped sending audio. Please check your microphone and start dictation again.`,
        );
        stopDictation();
      },
    });

  useEffect(() => {
    onTranscriptChunkRef.current = onTranscriptChunk;
  }, [onTranscriptChunk]);

  useEffect(() => {
    onVadAutoStopRef.current = onVadAutoStop;
  }, [onVadAutoStop]);

  useEffect(() => {
    isHesitationOnlyRef.current = isHesitationOnly;
  }, [isHesitationOnly]);

  useEffect(() => {
    overVoiceMinSpeechMsRef.current =
      resolveOverVoiceMinSpeechMs(overVoiceMinSpeechMs);
    onSpeechOverVoiceRef.current = onSpeechOverVoice;
    onVoiceLoweredRef.current = onVoiceLowered;
  }, [onSpeechOverVoice, onVoiceLowered, overVoiceMinSpeechMs]);

  const releaseHold = useCallback((reason: "speech" | "voice_ended") => {
    const hold = holdRef.current;
    if (!hold || hold.released) return;
    hold.released = reason;
    if (hold.lowered) {
      hold.lowered = false;
      onVoiceLoweredRef.current?.(false);
    }
    hold.waiter?.(reason);
  }, []);

  useEffect(() => {
    voiceSpeakingRef.current = voiceSpeaking;
    if (!voiceSpeaking) releaseHold("voice_ended");
  }, [releaseHold, voiceSpeaking]);

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

  const closeQuietly = useCallback((socket: WebSocket | undefined | null) => {
    if (!socket) return;
    quietSocketsRef.current.add(socket);
    socket.close();
  }, []);

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
      const startMs = session.sentMs;
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
      session.sentMs = endMs;

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
      // Cancelled before it began: no socket at all.
      if (signal.aborted) {
        throw new DOMException("Aborted", "AbortError");
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
      // Only the recording's own live socket reports: during the handshake a
      // failure arrives as the rejection below, and a socket this hook has
      // closed or left behind says nothing about the current recording.
      const isLive = () =>
        !quietSocketsRef.current.has(socket) &&
        liveSessionRef.current?.socket === socket;
      // Abort during the handshake → close the socket so the protocol
      // helpers' close listeners (or signal listeners) fire promptly
      // and the awaits unwind.
      const handleAbortDuringStartup = () => {
        if (socket.readyState !== WebSocket.CLOSED) closeQuietly(socket);
      };
      signal.addEventListener("abort", handleAbortDuringStartup, {
        once: true,
      });

      const words = {
        transcripts: new Map<number, string | null>(),
        onTranscript: new Set<() => void>(),
      };
      const deliver = (chunk: AudioDictationTranscriptChunk) => {
        const held = liveSessionRef.current?.held;
        if (held) held.push(chunk);
        else onTranscriptChunkRef.current(chunk);
      };
      socket.addEventListener("message", (event) => {
        if (typeof event.data !== "string") {
          return;
        }

        if (!isLive()) {
          // During the handshake: a refusal is not tried again.
          try {
            const frame = JSON.parse(event.data) as AudioDictationSocketFrame;
            if (frame.type === "error") refusedSockets.add(socket);
          } catch {
            // Not a frame this hook reads.
          }
          return;
        }
        try {
          const frame = JSON.parse(event.data) as AudioDictationSocketFrame;
          if (frame.type === "chunk_transcribed") {
            words.transcripts.set(frame.chunk_index, frame.transcript ?? "");
            words.onTranscript.forEach((listener) => listener());
            deliver({
              chunkIndex: frame.chunk_index,
              transcript: frame.transcript ?? "",
            });
          }
          if (frame.type === "chunk_failed") {
            words.transcripts.set(frame.chunk_index, null);
            words.onTranscript.forEach((listener) => listener());
            // Resolve the index with an empty transcript so the ordered append
            // in the consumer is not held back by the lost passage.
            deliver({
              chunkIndex: frame.chunk_index,
              transcript: "",
            });
            setDictationError(
              describeAudioTranscriptionFailure(frame, {
                fallback: t`Audio dictation failed.`,
                passageStartMs:
                  frame.chunk_index *
                  (liveSessionRef.current?.chunkDurationMs ??
                    DEFAULT_AUDIO_DICTATION_CHUNK_DURATION_MS),
              }),
            );
          }
          if (frame.type === "error") {
            setDictationError(
              describeAudioTranscriptionFailure(frame, {
                fallback: t`Audio dictation failed.`,
              }),
            );
          }
        } catch {
          setDictationError(t`Could not read audio dictation response.`);
        }
      });

      socket.addEventListener("error", () => {
        if (!isLive()) return;
        setDictationError(t`Audio dictation connection failed.`);
      });

      let opened = false;
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

        opened = true;
        return {
          socket,
          chunkDurationMs:
            sessionFrame.chunk_duration_ms ??
            DEFAULT_AUDIO_DICTATION_CHUNK_DURATION_MS,
          nextChunkIndex: sessionFrame.next_chunk_index ?? 0,
          sendQueue: Promise.resolve(),
          sentPcmBytes: 0,
          sentMs: 0,
          ...words,
          held: null,
          blanked: new Set(),
          firstChunkIndex: sessionFrame.next_chunk_index ?? 0,
          pendingSourceSamples: [],
          sourceSampleRate,
        };
      } catch (error) {
        if (refusedSockets.has(socket) && error instanceof Error)
          refusedErrors.add(error);
        throw error;
      } finally {
        signal.removeEventListener("abort", handleAbortDuringStartup);
        if (pendingSocketRef.current === socket)
          pendingSocketRef.current = null;
        if (!opened) closeQuietly(socket);
      }
    },
    [closeQuietly, enabled, isMounted, mode],
  );

  /** Opens the session; a failure to connect is tried once more, the audio kept meanwhile. */
  const openLiveDictationSession = useCallback(
    async (
      sourceSampleRate: number,
      signal: AbortSignal,
    ): Promise<LiveAudioDictationSession> => {
      try {
        return await startLiveDictationSession(sourceSampleRate, signal);
      } catch (error) {
        // Classic dictation reports at once, as before; a refusal would only
        // be refused again.
        if (
          isAbort(error) ||
          signal.aborted ||
          mode !== "conversational" ||
          (error instanceof Error && refusedErrors.has(error))
        )
          throw error;
        logger.log("[AUDIO_DICT] session failed, trying once more", error);
        await abortableDelay(SESSION_RETRY_DELAY_MS, signal);
        return startLiveDictationSession(sourceSampleRate, signal);
      }
    },
    [mode, startLiveDictationSession],
  );

  /**
   * A conversational turn is cut in a pause, never inside a word: only what
   * the detector has already judged goes into the piece, so the start of the
   * next word stays for the next one.
   */
  const cutAtPause = useCallback(
    (gate: SpeechGate) => {
      const session = liveSessionRef.current;
      if (!session || gate.quietFrames < PAUSE_FRAMES) return;
      const pending = session.pendingSourceSamples.length;
      const unjudged = Math.max(0, gate.fed - gate.judged);
      const cut = pending - unjudged;
      const atLeast = Math.floor(
        (session.sourceSampleRate * CUT_AT_PAUSE_AFTER_MS) / 1000,
      );
      if (cut < atLeast) return;
      sendLivePcmChunk(
        resampleMonoFloat32ToPcm16(
          new Float32Array(session.pendingSourceSamples.splice(0, cut)),
          session.sourceSampleRate,
        ),
      );
    },
    [sendLivePcmChunk],
  );

  /** Hands the words held back to the caller, those of hesitations empty. */
  const releaseHeldTranscripts = useCallback(
    (session: LiveAudioDictationSession) => {
      const held = session.held;
      if (!held) return;
      session.held = null;
      for (const chunk of held)
        onTranscriptChunkRef.current(
          session.blanked.has(chunk.chunkIndex)
            ? { chunkIndex: chunk.chunkIndex, transcript: "" }
            : chunk,
        );
    },
    [],
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
      // A recording cancelled meanwhile reports nothing.
      if (session && !quietSocketsRef.current.has(session.socket)) {
        setDictationError(
          error instanceof Error
            ? error.message
            : t`Failed to complete audio dictation.`,
        );
      }
    } finally {
      if (liveSessionRef.current === session) liveSessionRef.current = null;
      closeQuietly(session?.socket);
      if (session) releaseHeldTranscripts(session);
      if (isMounted()) {
        dispatchSession({ type: "complete" });
      }
    }
  }, [closeQuietly, flushLiveAudioSamples, isMounted, releaseHeldTranscripts]);

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

    // The turn ended while its connection opens: what was heard is kept and
    // finished once the connection is there.
    if (gateRef.current?.heard && sessionAbortRef.current) {
      finishWhenOpenRef.current = true;
      clearRecordingDurationTimer();
      if (isMounted()) {
        dispatchSession({ type: "user_stop" });
      }
      const kept = preSessionSamplesRef.current;
      tearDownCaptureGraph();
      preSessionSamplesRef.current = kept;
      return;
    }

    // Nothing heard yet, or a startup in flight: aborting the per-session signal
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

  /**
   * Ends the recording and drops what it heard: nothing more is sent for
   * transcription and no words arrive. For a recording whose words are no
   * longer wanted, such as one for a card that was decided.
   */
  /** What the detector heard in the last recording, as a copy. */
  const readRecordingSignals = useCallback(
    (): RecordingSignals | null =>
      recordingSignalsRef.current ? { ...recordingSignalsRef.current } : null,
    [],
  );

  const cancelDictation = useCallback(() => {
    finishWhenOpenRef.current = false;
    const session = liveSessionRef.current;
    liveSessionRef.current = null;
    closeQuietly(session?.socket);
    sessionAbortRef.current?.abort();
    sessionAbortRef.current = null;
    clearRecordingDurationTimer();
    dispatchSession({ type: "abort" });
    tearDownCaptureGraph();
  }, [clearRecordingDurationTimer, closeQuietly, tearDownCaptureGraph]);

  const startDictation = useCallback(
    async (turn?: DictationTurn) => {
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
      setHeldHesitation(null);
      /** The hesitation check of this recording, once its detector runs. */
      let checkTurnLater: (() => void) | undefined;
      /** A turn heard to end while the detector caught up: checked once open. */
      let checkWhenOpen = false;
      gateRef.current = null;
      preDroppedRef.current = 0;
      checkHesitationsRef.current =
        vadAutoStopEnabled &&
        isHesitationOnlyRef.current !== undefined &&
        !turn?.keepHesitations;
      dispatchSession({ type: "start" });
      const sessionAbort = new AbortController();
      sessionAbortRef.current = sessionAbort;
      const hold: OverVoiceHold | null =
        vadAutoStopEnabled && voiceSpeakingRef.current
          ? { released: null, gate: overVoiceGate(), lowered: false }
          : null;
      holdRef.current = hold;
      // Taken before the microphone opens, so a first speech counted from
      // here is never later than it was.
      recordingSignalsRef.current = {
        startedAt: Date.now(),
        endedAt: 0,
        firstSpeechAt: null,
        speechMs: 0,
        recordedMs: 0,
        overVoice: hold !== null,
      };
      if (hold === null) microphoneOpened();

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
        // Over the voice, the browser's echo cancellation keeps the voice
        // from hearing itself; otherwise the raw signal as before. It stays
        // on for the rest of the turn: switched off when the voice ends, the
        // sound would change in the middle of the user's words.
        echoCancellation: hold !== null,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: { ideal: 1 },
        sampleRate: { ideal: CANONICAL_AUDIO_SAMPLE_RATE_HZ },
      };

      try {
        let stream: MediaStream;
        try {
          stream = await requestAudioStream(mediaDevices, {
            audio: selectedAudioInputDeviceId
              ? {
                  deviceId: { exact: selectedAudioInputDeviceId },
                  ...baseAudioConstraints,
                }
              : baseAudioConstraints,
          });
        } catch (firstError) {
          // The stored device can be gone at capture time (Bluetooth drop or
          // profile switch): use the system default for this session only.
          if (
            selectedAudioInputDeviceId &&
            firstError instanceof DOMException &&
            (firstError.name === "OverconstrainedError" ||
              firstError.name === "NotFoundError")
          ) {
            stream = await requestAudioStream(mediaDevices, {
              audio: baseAudioConstraints,
            });
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
        let primerSamples: number[] = [];
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
          primerSamples = primer;
          preSessionSamplesRef.current = [...primer];
          const heldSampleCount = Math.floor(
            (audioContext.sampleRate * HELD_AUDIO_MS) / 1000,
          );
          const beforeSpeechSampleCount = Math.floor(
            (audioContext.sampleRate * BEFORE_SPEECH_KEPT_MS) / 1000,
          );
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
            const gate = gateRef.current;
            const detector = gate?.catchingUp ? null : vadEngineRef.current;
            const vadFrame = detector ? new Float32Array(input) : null;
            onsetController.acceptFrame(input);
            const session = liveSessionRef.current;
            // Into the session only while speech is heard; otherwise the
            // audio waits, and only its last moments are kept.
            if (session && (!gate || gate.heard)) {
              for (let index = 0; index < input.length; index += 1) {
                session.pendingSourceSamples.push(input[index]);
              }
              flushLiveAudioSamples(false);
            } else {
              const preBuffer = preSessionSamplesRef.current;
              for (let index = 0; index < input.length; index += 1) {
                preBuffer.push(input[index]);
              }
              const drop = (keep: number) => {
                const dropped = preBuffer.length - keep;
                preBuffer.splice(0, dropped);
                preDroppedRef.current += dropped;
              };
              // Trimmed in batches: only the last moments over the voice count.
              if (
                holdRef.current?.released === null &&
                preBuffer.length > 2 * heldSampleCount
              ) {
                drop(heldSampleCount);
              }
              // Before anyone speaks, only the moments before speech are
              // kept, and only once the detector has heard what is dropped:
              // while it loads, everything is kept for it (ERMAIN-334).
              if (
                gate &&
                detector &&
                holdRef.current?.released !== null &&
                !gate.heard &&
                !gate.speaking &&
                preBuffer.length > 2 * beforeSpeechSampleCount
              ) {
                drop(beforeSpeechSampleCount);
                gate.trimmed = true;
              }
            }
            if (vadFrame && detector) {
              if (gate) gate.fed += vadFrame.length;
              void detector
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
            const tuning = {
              redemptionMs: resolveEndOfTurnSilenceMs(
                turn?.endOfTurnSilenceMs ?? endOfTurnSilenceMs,
              ),
              minSpeechMs: resolveMinSpeechMs(
                turn?.minSpeechMs ?? minSpeechMs,
                DEFAULT_MIN_SPEECH_MS,
              ),
            };
            const vadEngine =
              persistentVadEngineRef.current ??
              createRicky0123VadEngine({
                model: "silero-v5",
                preSpeechPadMs: 500,
                ...tuning,
              });
            persistentVadEngineRef.current = vadEngine;
            vadEngine.configure?.(tuning);
            const gate: SpeechGate = {
              heard: false,
              speaking: false,
              realStarted: false,
              trimmed: false,
              quietFrames: 0,
              fed: 0,
              judged: 0,
              catchingUp: true,
              endedWhileCatchingUp: false,
              checking: false,
            };
            gateRef.current = gate;
            // After a misfire, keep less than the silence that ended it, or
            // the rejected sound itself would stay.
            const keptAfterMisfire = Math.min(
              beforeSpeechSampleCount,
              Math.floor(
                (audioContext.sampleRate *
                  Math.max(0, tuning.redemptionMs - MISFIRE_MARGIN_MS)) /
                  1000,
              ),
            );
            checkTurnLater = () => void checkTurn();
            const endTurn = () => {
              vadAutoStopTriggeredRef.current = true;
              onVadAutoStopRef.current?.();
              stopDictation();
            };
            /**
             * The turn seems over: its words decide. Hesitation sounds only,
             * or nothing, end no turn: the recording listens on, and what
             * they were is not passed on.
             */
            const checkTurn = async () => {
              const session = liveSessionRef.current;
              if (!session) {
                endTurn();
                return;
              }
              gate.checking = true;
              gate.recheck = false;
              // What follows waits for speech again: the pause is not sent.
              gate.heard = false;
              // Only what the detector has judged belongs to these words; the
              // newest audio waits with what follows, should speech go on.
              const pending = session.pendingSourceSamples;
              const unjudged = Math.max(
                0,
                Math.min(pending.length, gate.fed - gate.judged),
              );
              const tail = pending.splice(pending.length - unjudged);
              flushLiveAudioSamples(true);
              preSessionSamplesRef.current = [
                ...tail,
                ...preSessionSamplesRef.current,
              ];
              preDroppedRef.current = 0;
              await session.sendQueue;
              const last = session.nextChunkIndex - 1;
              const words = await waitForWords(
                session,
                last,
                HESITATION_CHECK_TIMEOUT_MS,
              );
              gate.checking = false;
              if (liveSessionRef.current !== session) return;
              const onlyHesitation = (text: string) =>
                text.trim() === "" ||
                isHesitationOnlyRef.current?.(text) === true;
              const nothingSaid = words !== null && onlyHesitation(words);
              // Each piece by its own words: "Äh." goes out empty, a "42."
              // after it as it was said.
              for (
                let index = session.firstChunkIndex;
                index <= last;
                index++
              ) {
                const own = session.transcripts.get(index);
                if (typeof own === "string" && onlyHesitation(own))
                  session.blanked.add(index);
              }
              if (nothingSaid && words.trim() !== "" && isMounted())
                setHeldHesitation(words.trim());
              // Read anew: the detector may have changed it during the wait.
              const now = currentGate(gate);
              if (now.recheck) {
                void checkTurn();
                return;
              }
              // The person went on, or only hesitated: the turn goes on.
              if (nothingSaid || now.heard) return;
              // The turn ends with the words checked. What came after them
              // is not sent: speech there would have reopened the gate, and
              // a piece of room sound alone can come back as a word.
              preSessionSamplesRef.current = [];
              preDroppedRef.current = 0;
              endTurn();
            };
            const unsubscribeVad = vadEngine.subscribe((event) => {
              if (event.type === "error") {
                stopVadEngine();
                return;
              }
              const waiting = holdRef.current?.released === null;
              if (event.type === "frame") {
                gate.judged += Math.round(
                  (event.frame.samples.length * audioContext.sampleRate) /
                    event.frame.sampleRate,
                );
                gate.quietFrames =
                  event.probabilities.isSpeech < SILENT_FRAME_PROBABILITY
                    ? gate.quietFrames + 1
                    : 0;
                const signals = recordingSignalsRef.current;
                if (signals) {
                  const frameMs =
                    (event.frame.samples.length / event.frame.sampleRate) *
                    1000;
                  signals.recordedMs += frameMs;
                  if (
                    event.probabilities.isSpeech >= SPEECH_FRAME_PROBABILITY
                  ) {
                    signals.firstSpeechAt ??=
                      signals.startedAt + signals.recordedMs - frameMs;
                    signals.speechMs += frameMs;
                  }
                  signals.endedAt = signals.startedAt + signals.recordedMs;
                }
                if (gate.heard) cutAtPause(gate);
                const current = holdRef.current;
                if (current?.released !== null) return;
                const step = overVoiceStep(
                  current.gate,
                  event.probabilities.isSpeech,
                  (event.frame.samples.length / event.frame.sampleRate) * 1000,
                  overVoiceMinSpeechMsRef.current,
                );
                current.gate = step.gate;
                if (step.confirmed) {
                  onSpeechOverVoiceRef.current?.();
                  releaseHold("speech");
                  return;
                }
                if (step.lowered !== current.lowered) {
                  current.lowered = step.lowered;
                  onVoiceLoweredRef.current?.(step.lowered);
                }
                return;
              }
              if (event.type === "speech_start") gate.speaking = true;
              if (event.type === "speech_real_start") gate.realStarted = true;
              if (event.type === "vad_misfire" || event.type === "speech_end") {
                gate.speaking = false;
                gate.realStarted = false;
              }
              // Over the voice, only the gate above ends the wait: the voice's
              // own sound or a short noise starts and ends no turn.
              if (waiting) return;
              if (
                event.type === "speech_start" ||
                event.type === "speech_real_start"
              ) {
                if (event.type === "speech_real_start") {
                  openSpeechGate(gate);
                  if (isMounted()) setHeldHesitation(null);
                  // Speech again within a recording: from shortly before it.
                  const session = liveSessionRef.current;
                  if (session) {
                    for (const sample of preSessionSamplesRef.current)
                      session.pendingSourceSamples.push(sample);
                    preSessionSamplesRef.current = [];
                    preDroppedRef.current = 0;
                  }
                }
                if (isMounted()) {
                  setIsVadSpeechActive(true);
                }
                return;
              }
              if (event.type === "vad_misfire") {
                // Too short to be a turn: it is dropped, not carried into the
                // next one. Only the moments before speech stay.
                // In the audio caught up on, the buffer runs on ahead of the
                // detector: it is trimmed once the detector has caught up.
                if (!gate.heard && gate.catchingUp)
                  gate.trimAfterCatchUp = true;
                if (!gate.heard && !gate.catchingUp) {
                  const preBuffer = preSessionSamplesRef.current;
                  if (preBuffer.length > keptAfterMisfire) {
                    const dropped = preBuffer.length - keptAfterMisfire;
                    preBuffer.splice(0, dropped);
                    preDroppedRef.current += dropped;
                    gate.trimmed = true;
                  }
                }
                if (isMounted()) {
                  setIsVadSpeechActive(false);
                }
                return;
              }

              if (isMounted()) {
                setIsVadSpeechActive(false);
              }
              if (vadAutoStopTriggeredRef.current) {
                return;
              }
              // The detector reports the end after the end-of-turn silence.
              markSpeechEnded(Date.now() - tuning.redemptionMs);
              openSpeechGate(gate);
              // Heard in the audio from while the detector loaded: the turn
              // ends once the recording is under way.
              if (gate.catchingUp) {
                gate.endedWhileCatchingUp = true;
                return;
              }
              if (gate.checking) {
                gate.recheck = true;
                return;
              }
              if (checkHesitationsRef.current) {
                void checkTurn();
                return;
              }
              endTurn();
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
                // What was said while the model loaded is heard first, in
                // order, before the detector takes the live audio.
                let position = preDroppedRef.current;
                while (audioProcessorRef.current === processor) {
                  const buffer = preSessionSamplesRef.current;
                  const from = Math.max(0, position - preDroppedRef.current);
                  if (from >= buffer.length) break;
                  const backlog = new Float32Array(buffer.slice(from));
                  position = preDroppedRef.current + buffer.length;
                  gate.fed += backlog.length;
                  await vadEngine.acceptFrame({
                    samples: backlog,
                    sampleRate: audioContext.sampleRate,
                    timestampMs: Date.now(),
                  });
                }
                gate.catchingUp = false;
                if (gate.trimAfterCatchUp && !gate.heard && !gate.speaking) {
                  const preBuffer = preSessionSamplesRef.current;
                  if (preBuffer.length > keptAfterMisfire) {
                    const dropped = preBuffer.length - keptAfterMisfire;
                    preBuffer.splice(0, dropped);
                    preDroppedRef.current += dropped;
                    gate.trimmed = true;
                  }
                }
                gate.trimAfterCatchUp = false;
                vadEngineRef.current = vadEngine;
                if (isMounted()) {
                  setIsVadListening(true);
                }
              } else {
                if (gateRef.current === gate) gateRef.current = null;
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
              // Model load failed — continue without auto-stop and without
              // waiting for speech; the warm instance is retained so the next
              // session can retry.
              if (gateRef.current === gate) gateRef.current = null;
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

        if (hold) {
          if (isMounted()) setIsListeningOverVoice(true);
          const reason = await waitForHold(hold, sessionAbort.signal);
          if (isMounted()) setIsListeningOverVoice(false);
          // Speech already under way as the voice ends is the start of the
          // turn: kept from shortly before it began, the detector going on.
          const keepMs =
            reason === "speech"
              ? HELD_AUDIO_MS
              : hold.gate.speechMs > 0
                ? Math.min(
                    HELD_AUDIO_MS,
                    hold.gate.speechMs + hold.gate.dipMs + SPEECH_LEAD_IN_MS,
                  )
                : 0;
          const gate = gateRef.current;
          if (keepMs === 0) {
            // Only what the user says from now on is theirs; what was heard
            // over the voice, and any speech the detector saw in it, is not.
            preSessionSamplesRef.current = [...primerSamples];
            preDroppedRef.current = 0;
            vadEngineRef.current?.reset?.();
            // Nothing was said over the voice: the recording counts as one
            // that opened after it, and may approve by voice.
            recordingSignalsRef.current = {
              startedAt: Date.now(),
              endedAt: 0,
              firstSpeechAt: null,
              speechMs: 0,
              recordedMs: 0,
              overVoice: false,
            };
            if (gate) {
              gate.speaking = false;
              gate.realStarted = false;
              gate.trimmed = false;
            }
          } else {
            if (gate && (reason === "speech" || gate.realStarted))
              openSpeechGate(gate);
            const preBuffer = preSessionSamplesRef.current;
            const keep = Math.floor((sourceSampleRate * keepMs) / 1000);
            if (preBuffer.length > keep)
              preBuffer.splice(0, preBuffer.length - keep);
          }
        }

        const armRecordingLimit = () => {
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
        };

        // A conversational recording listens before it transcribes: no
        // connection and no upload until speech is heard.
        const gate = gateRef.current;
        if (gate) {
          armRecordingLimit();
          dispatchSession({ type: "session_ready" });
          setDictationError(null);
          if (gate.endedWhileCatchingUp && !vadAutoStopTriggeredRef.current) {
            // Its words are checked like any other turn's, once the
            // connection is open.
            if (checkHesitationsRef.current && checkTurnLater) {
              checkWhenOpen = true;
            } else {
              vadAutoStopTriggeredRef.current = true;
              onVadAutoStopRef.current?.();
              stopDictation();
            }
          }
          await waitForSpeech(gate, sessionAbort.signal);
        }

        const liveSession = await openLiveDictationSession(
          sourceSampleRate,
          sessionAbort.signal,
        );
        // Cancelled in the moment the connection came: it is not used.
        if (sessionAbort.signal.aborted) {
          closeQuietly(liveSession.socket);
          throw new DOMException("Aborted", "AbortError");
        }

        // Drain pre-buffered samples into the new session in their original
        // order, THEN publish the session ref. Order matters: until
        // `liveSessionRef.current` is set, `processor.onaudioprocess` keeps
        // pushing to `preSessionSamplesRef`. The drain → ref-assign → flush
        // sequence is one synchronous block, so no audio frame can interleave
        // and split samples across the two buffers.
        if (gate?.trimmed) {
          for (const sample of primerSamples)
            liveSession.pendingSourceSamples.push(sample);
        }
        const preBuffer = preSessionSamplesRef.current;
        if (preBuffer.length > 0) {
          for (let index = 0; index < preBuffer.length; index += 1) {
            liveSession.pendingSourceSamples.push(preBuffer[index]);
          }
          preSessionSamplesRef.current = [];
          preDroppedRef.current = 0;
        }
        liveSession.held = checkHesitationsRef.current ? [] : null;
        liveSessionRef.current = liveSession;
        if (finishWhenOpenRef.current) {
          finishWhenOpenRef.current = false;
          void completeDictation();
          return;
        }
        flushLiveAudioSamples(false);
        if (checkWhenOpen) checkTurnLater?.();

        if (!gate) {
          armRecordingLimit();
          dispatchSession({ type: "session_ready" });
          setDictationError(null);
        }
      } catch (error) {
        finishWhenOpenRef.current = false;
        closeQuietly(liveSessionRef.current?.socket);
        liveSessionRef.current = null;
        tearDownCaptureGraph();
        if (isMounted()) {
          dispatchSession({ type: "abort" });
          // A cancel while starting or waiting for speech is no failure.
          if (!isAbort(error) && !sessionAbort.signal.aborted) {
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
        if (hold) {
          if (hold.lowered) {
            hold.lowered = false;
            onVoiceLoweredRef.current?.(false);
          }
          if (holdRef.current === hold) holdRef.current = null;
          if (isMounted()) setIsListeningOverVoice(false);
        }
      }
    },
    [
      clearRecordingDurationTimer,
      closeQuietly,
      completeDictation,
      cutAtPause,
      enabled,
      endOfTurnSilenceMs,
      ensureAudioContextReady,
      minSpeechMs,
      flushLiveAudioSamples,
      openLiveDictationSession,
      isDictating,
      isDictationCompleting,
      isDictationStarting,
      isMounted,
      maxRecordingDurationSeconds,
      releaseHold,
      selectedAudioInputDeviceId,
      setDictationBarsThrottled,
      stopDictation,
      stopVadEngine,
      tearDownCaptureGraph,
      vadAutoStopEnabled,
      watchCaptureTrack,
    ],
  );

  /** Stops a running recording, or starts one, tuned by `turn` when given. */
  const toggleDictation = useCallback(
    (turn?: DictationTurn) => {
      if (isDictating || isDictationStarting) {
        stopDictation();
        return;
      }

      void startDictation(turn);
    },
    [isDictating, isDictationStarting, startDictation, stopDictation],
  );

  useEffect(() => {
    return () => {
      startInFlightRef.current = false;

      // Abort any in-flight startup; its signal listener closes the
      // pending socket as part of teardown.
      sessionAbortRef.current?.abort();
      sessionAbortRef.current = null;
      closeQuietly(liveSessionRef.current?.socket);
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
  }, [
    clearRecordingDurationTimer,
    closeQuietly,
    stopRecordingVisualizer,
    stopVadEngine,
  ]);

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
    isListeningOverVoice,
    heldHesitation,
    toggleDictation,
    cancelDictation,
    readRecordingSignals,
  };
}

/** Sockets the server refused with an `error` frame while starting. */
const refusedSockets = new WeakSet<WebSocket>();
/** The startup errors those refusals became: not tried again. */
const refusedErrors = new WeakSet<Error>();

/**
 * The words of the session's pieces up to `last`, once all came back;
 * `null` when one failed or they took longer than `ms`.
 */
function waitForWords(
  session: LiveAudioDictationSession,
  last: number,
  ms: number,
): Promise<string | null> {
  return new Promise((resolve) => {
    const finish = (words: string | null) => {
      clearTimeout(timer);
      session.onTranscript.delete(check);
      resolve(words);
    };
    const check = () => {
      const pieces: (string | null | undefined)[] = [];
      for (let index = session.firstChunkIndex; index <= last; index++)
        pieces.push(session.transcripts.get(index));
      if (pieces.some((piece) => piece === undefined)) return;
      finish(pieces.some((piece) => piece === null) ? null : pieces.join(" "));
    };
    const timer = setTimeout(() => finish(null), ms);
    session.onTranscript.add(check);
    check();
  });
}

/** The gate as it is now, not as it was before an `await`. */
const currentGate = (gate: SpeechGate): SpeechGate => gate;

/** Speech was heard: the recording transcribes from here on. */
function openSpeechGate(gate: SpeechGate) {
  if (gate.heard) return;
  gate.heard = true;
  gate.waiter?.();
}

/** Resolves once speech is heard; rejects when the recording is cancelled. */
function waitForSpeech(gate: SpeechGate, signal: AbortSignal): Promise<void> {
  if (gate.heard) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const abort = () => {
      gate.waiter = undefined;
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    gate.waiter = () => {
      signal.removeEventListener("abort", abort);
      gate.waiter = undefined;
      resolve();
    };
  });
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

/** Resolves when the wait over the voice ends; rejects when the recording is cancelled. */
function waitForHold(
  hold: OverVoiceHold,
  signal: AbortSignal,
): Promise<"speech" | "voice_ended"> {
  if (hold.released) return Promise.resolve(hold.released);
  return new Promise((resolve, reject) => {
    const abort = () => {
      hold.waiter = undefined;
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    hold.waiter = (reason) => {
      signal.removeEventListener("abort", abort);
      hold.waiter = undefined;
      resolve(reason);
    };
  });
}
