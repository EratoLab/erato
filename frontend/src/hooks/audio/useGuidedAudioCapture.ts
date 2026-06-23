import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMountedState } from "react-use";

// `?worker&url` routes the worklet through Vite's worker bundling so it is
// served as a standalone module URL for `audioWorklet.addModule()` — the
// same import the dictation recorder uses (see its header note on why the
// `new URL("./worklet.ts", import.meta.url)` pattern does not work here).
import audioDictationWorkletUrl from "./audio-dictation-worklet.ts?worker&url";
import {
  logCaptureComplete,
  logCaptureContextReady,
  logCaptureError,
} from "./captureDiagnostics";

const AUDIO_DICTATION_WORKLET_PROCESSOR_NAME = "audio-dictation-processor";

const DEFAULT_QUIET_MS = 2_000;
const DEFAULT_READ_MS = 4_000;
const CAPTURE_SAMPLE_RATE_HZ = 16_000;

/**
 * Settle window discarded after the mic opens and before the quiet phase
 * begins measuring. The OS/driver warm-up emits zeros (Chromium) or a
 * low-level DC bias (WebKit) that would otherwise pollute the noise-floor
 * baseline. Mirrors the onset detector's calibration philosophy. Measured
 * in AUDIO time (delivered samples), not wall-clock — see the phase notes.
 */
const SETTLE_MS = 350;

/**
 * Wall-clock multiple of the expected capture duration after which a capture
 * that has not finished is treated as a stalled device. The phases advance
 * on the audio sample clock, which never advances if frames stop flowing
 * (dead mic, revoked track, suspended-forever context), so this is the
 * frame-independent guarantee that the UI can't hang. Generous, since a
 * late-resuming WebKit context legitimately stretches wall-clock time.
 */
const CAPTURE_BACKSTOP_FACTOR = 2;
const CAPTURE_BACKSTOP_FLOOR_MS = 3_000;

export type GuidedCapturePhase =
  | "idle"
  | "preparing"
  | "quiet"
  | "reading"
  | "complete"
  | "error";

/** Half-open [startSample, endSample) range within the captured buffer. */
export type CaptureSampleRange = {
  startSample: number;
  endSample: number;
};

export type GuidedCaptureResult = {
  /**
   * Full captured PCM at `sampleRate`. The rate is read back from the live
   * AudioContext (authoritative), not the requested 16 kHz — WebKit may
   * ignore the requested rate, and resampling/encoding against the wrong
   * value is what produces stretched, robotic playback.
   */
  samples: Float32Array;
  sampleRate: number;
  /** Quiet (noise-floor) phase span. */
  quietRange: CaptureSampleRange;
  /** Read-aloud (speech) phase span. */
  speechRange: CaptureSampleRange;
};

export type GuidedCaptureState = {
  phase: GuidedCapturePhase;
  /** Whole seconds left in the current timed phase; 0 outside quiet/reading. */
  secondsRemaining: number;
  /** Progress 0→1 through the current timed phase. */
  phaseProgress: number;
  error: string | null;
  result: GuidedCaptureResult | null;
  activeDeviceLabel: string | null;
  /** Begin the quiet→read-aloud capture sequence. */
  start: () => void;
  /** Abort an in-flight capture and release the microphone. */
  cancel: () => void;
  /** Clear a completed/errored capture back to idle (mic already released). */
  reset: () => void;
};

export type UseGuidedAudioCaptureOptions = {
  /** Selected device id; "" means the browser's default microphone. */
  deviceId: string;
  /** Duration of the quiet noise-floor phase. */
  quietMs?: number;
  /** Duration of the read-aloud phase. */
  readMs?: number;
  /**
   * When false, any in-flight capture is torn down and the mic released.
   * Pass the panel's visibility so closing the dialog/tab frees the device.
   */
  enabled?: boolean;
  onComplete?: (result: GuidedCaptureResult) => void;
  /**
   * Fired once when the capture stream successfully opens. Lets the device
   * list re-enumerate while a stream is live so WebKit/Safari exposes real
   * device labels. Held in a ref internally so an unstable callback does
   * not affect the capture lifecycle.
   */
  onStreamActive?: () => void;
};

/** Internal sample-clock state machine, distinct from the public phase. */
type CaptureStage = "idle" | "settling" | "quiet" | "reading" | "done";

/**
 * Reusable guided audio capture: a timed quiet → read-aloud sequence with a
 * visible countdown, returning the recorded PCM plus per-phase sample
 * boundaries. The mic-check is one consumer (it runs acoustic analysis +
 * shows a transcript on the result); future voice-recognition sampling /
 * speaker enrollment is another. Deliberately generic — it owns capture,
 * phase sequencing, the countdown, and the on-device/ephemeral guarantees,
 * and knows nothing about analysis, verdicts, or transcripts.
 *
 * Capture path mirrors the dictation recorder: getUserMedia with
 * echoCancellation/noiseSuppression/autoGainControl off (raw signal for
 * honest measurement), mono, 16 kHz ideal, fed through the shared audio
 * worklet which posts 4096-sample frames accumulated here for replay +
 * analysis. The buffer never leaves the device; the only network touch is
 * the optional transcript step, owned by the consumer.
 *
 * Timing is driven by the AUDIO SAMPLE CLOCK, not wall-clock: each phase
 * advances once the required number of delivered samples
 * (`durationMs * sampleRate`) has arrived, and the AudioContext is pinned to
 * the track rate and confirmed `running` before counting starts. This keeps
 * the captured buffer, the analysis windows, and the replay/transcript
 * encoding consistent across browsers — notably on WebKit, where a
 * wall-clock timer drifts from a late-resuming context and an unpinned
 * context produces a rate mismatch.
 */
export function useGuidedAudioCapture({
  deviceId,
  quietMs = DEFAULT_QUIET_MS,
  readMs = DEFAULT_READ_MS,
  enabled = true,
  onComplete,
  onStreamActive,
}: UseGuidedAudioCaptureOptions): GuidedCaptureState {
  const onStreamActiveRef = useRef(onStreamActive);
  onStreamActiveRef.current = onStreamActive;

  const [phase, setPhase] = useState<GuidedCapturePhase>("idle");
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const [phaseProgress, setPhaseProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GuidedCaptureResult | null>(null);
  const [activeDeviceLabel, setActiveDeviceLabel] = useState<string | null>(
    null,
  );

  const isMounted = useMountedState();

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);

  // Captured frames and the running sample count, both measured from the
  // start of the quiet phase (settle-phase frames are discarded, not pushed).
  const chunksRef = useRef<Float32Array[]>([]);
  const totalSamplesRef = useRef(0);
  const speechStartSampleRef = useRef(0);

  // Sample-clock state machine. `stageRef` is the source of truth for which
  // phase a delivered frame belongs to; the public `phase` is derived from it.
  const stageRef = useRef<CaptureStage>("idle");
  const sampleRateRef = useRef(CAPTURE_SAMPLE_RATE_HZ);
  const settleTargetSamplesRef = useRef(0);
  const quietTargetSamplesRef = useRef(0);
  const readTargetSamplesRef = useRef(0);
  const settleSamplesRef = useRef(0);

  // Dev-diagnostics only: total frames delivered (incl. settle) and the
  // wall-clock start, used to compute the measured frame rate vs the tagged
  // context rate (the Safari stretch signal). See `captureDiagnostics`.
  const deliveredSamplesRef = useRef(0);
  const captureStartedAtRef = useRef(0);
  const firstFrameAtRef = useRef(0);
  // AudioContext.currentTime at capture start — lets the diagnostic compare
  // the context's own audio clock against wall-clock (slow-clock vs drops).
  const captureContextStartRef = useRef(0);

  const backstopTimeoutRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  // Bumped on every start()/cancel()/teardown so a late async acquire from a
  // superseded run can detect it was cancelled and bail.
  const runIdRef = useRef(0);

  const clearTimers = useCallback(() => {
    if (backstopTimeoutRef.current !== null) {
      window.clearTimeout(backstopTimeoutRef.current);
      backstopTimeoutRef.current = null;
    }
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const releaseAudioGraph = useCallback(() => {
    workletRef.current?.disconnect();
    workletRef.current?.port.close();
    sourceRef.current?.disconnect();
    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }
    workletRef.current = null;
    sourceRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  const teardown = useCallback(() => {
    runIdRef.current += 1;
    clearTimers();
    releaseAudioGraph();
    chunksRef.current = [];
    totalSamplesRef.current = 0;
    settleSamplesRef.current = 0;
    speechStartSampleRef.current = 0;
    deliveredSamplesRef.current = 0;
    firstFrameAtRef.current = 0;
    captureContextStartRef.current = 0;
    stageRef.current = "idle";
  }, [clearTimers, releaseAudioGraph]);

  useEffect(() => {
    return () => {
      teardown();
    };
  }, [teardown]);

  // Release the mic whenever the consumer hides the panel mid-capture.
  useEffect(() => {
    if (!enabled) {
      teardown();
      if (isMounted()) {
        setPhase("idle");
        setSecondsRemaining(0);
        setPhaseProgress(0);
      }
    }
  }, [enabled, isMounted, teardown]);

  const assembleSamples = useCallback((): Float32Array => {
    const total = totalSamplesRef.current;
    const merged = new Float32Array(total);
    let offset = 0;
    for (const chunk of chunksRef.current) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return merged;
  }, []);

  const finish = useCallback(() => {
    stageRef.current = "done";
    clearTimers();
    const sampleRate = sampleRateRef.current;
    const samples = assembleSamples();
    const speechStart = Math.min(speechStartSampleRef.current, samples.length);
    const captured: GuidedCaptureResult = {
      samples,
      sampleRate,
      quietRange: { startSample: 0, endSample: speechStart },
      speechRange: { startSample: speechStart, endSample: samples.length },
    };
    logCaptureComplete({
      contextSampleRate: sampleRate,
      deliveredSamples: deliveredSamplesRef.current,
      elapsedMs: window.performance.now() - captureStartedAtRef.current,
      firstFrameDelayMs:
        firstFrameAtRef.current > 0
          ? firstFrameAtRef.current - captureStartedAtRef.current
          : 0,
      contextElapsedSec:
        (audioContextRef.current?.currentTime ??
          captureContextStartRef.current) - captureContextStartRef.current,
      totalSamples: samples.length,
      quietSamples: speechStart,
      speechSamples: samples.length - speechStart,
    });
    // Audio is fully captured — release the mic immediately; replay/analysis
    // work off the in-memory buffer.
    releaseAudioGraph();
    if (!isMounted()) {
      return;
    }
    setSecondsRemaining(0);
    setPhaseProgress(1);
    setResult(captured);
    setPhase("complete");
    onComplete?.(captured);
  }, [assembleSamples, clearTimers, isMounted, onComplete, releaseAudioGraph]);

  // Smooth countdown for the ring, driven by the sample clock (not wall-clock)
  // so the display honestly reflects audio progress — it slows/pauses if
  // frames stall, instead of finishing while no audio has arrived.
  const startCountdownLoop = useCallback(() => {
    const tick = () => {
      if (!isMounted()) {
        return;
      }
      const stage = stageRef.current;
      if (stage === "quiet" || stage === "reading") {
        const sampleRate = sampleRateRef.current || CAPTURE_SAMPLE_RATE_HZ;
        const target =
          stage === "quiet"
            ? quietTargetSamplesRef.current
            : readTargetSamplesRef.current;
        const done =
          stage === "quiet"
            ? totalSamplesRef.current
            : totalSamplesRef.current - speechStartSampleRef.current;
        setSecondsRemaining(Math.ceil(Math.max(0, target - done) / sampleRate));
        setPhaseProgress(target > 0 ? Math.min(1, done / target) : 1);
      }
      if (stage === "settling" || stage === "quiet" || stage === "reading") {
        rafRef.current = window.requestAnimationFrame(tick);
      }
    };
    rafRef.current = window.requestAnimationFrame(tick);
  }, [isMounted]);

  // Consumes one worklet frame and advances the sample-clock state machine.
  // Stable across renders via a ref so the worklet handler never needs
  // re-subscribing.
  const handleFrame = useCallback(
    (frame: Float32Array) => {
      if (stageRef.current !== "idle" && stageRef.current !== "done") {
        // Count every delivered frame (incl. settle) for the dev rate check,
        // and stamp the first frame so the measured rate can be corrected for
        // worklet startup latency (distinguishes a slow start from a genuine
        // sub-realtime clock).
        if (deliveredSamplesRef.current === 0) {
          firstFrameAtRef.current = window.performance.now();
        }
        deliveredSamplesRef.current += frame.length;
      }
      switch (stageRef.current) {
        case "settling": {
          settleSamplesRef.current += frame.length;
          if (settleSamplesRef.current >= settleTargetSamplesRef.current) {
            // Warm-up discarded — start measuring the noise floor at sample 0.
            chunksRef.current = [];
            totalSamplesRef.current = 0;
            stageRef.current = "quiet";
            if (isMounted()) {
              setPhase("quiet");
              setSecondsRemaining(Math.ceil(quietMs / 1000));
              setPhaseProgress(0);
            }
          }
          return;
        }
        case "quiet": {
          chunksRef.current.push(frame);
          totalSamplesRef.current += frame.length;
          if (totalSamplesRef.current >= quietTargetSamplesRef.current) {
            speechStartSampleRef.current = totalSamplesRef.current;
            stageRef.current = "reading";
            if (isMounted()) {
              setPhase("reading");
              setSecondsRemaining(Math.ceil(readMs / 1000));
              setPhaseProgress(0);
            }
          }
          return;
        }
        case "reading": {
          chunksRef.current.push(frame);
          totalSamplesRef.current += frame.length;
          if (
            totalSamplesRef.current - speechStartSampleRef.current >=
            readTargetSamplesRef.current
          ) {
            finish();
          }
          return;
        }
        default:
          // idle / done — ignore late frames.
          return;
      }
    },
    [finish, isMounted, quietMs, readMs],
  );
  const handleFrameRef = useRef(handleFrame);
  handleFrameRef.current = handleFrame;

  const failCapture = useCallback(
    (message: string) => {
      logCaptureError(message);
      teardown();
      if (isMounted()) {
        setError(message);
        setPhase("error");
        setSecondsRemaining(0);
        setPhaseProgress(0);
      }
    },
    [isMounted, teardown],
  );
  const failCaptureRef = useRef(failCapture);
  failCaptureRef.current = failCapture;

  const mapGetUserMediaError = useCallback((err: unknown): string => {
    const name = err instanceof DOMException ? err.name : undefined;
    if (name === "NotAllowedError" || name === "SecurityError") {
      return t`Microphone permission denied. Allow access to run the mic check.`;
    }
    if (name === "NotFoundError" || name === "OverconstrainedError") {
      return t`The selected microphone is not available. Refresh the device list and try again.`;
    }
    if (name === "NotReadableError") {
      return t`The microphone is already in use by another application or recording.`;
    }
    return t`Could not start the microphone check.`;
  }, []);

  const start = useCallback(() => {
    teardown();
    const runId = runIdRef.current;
    const isCurrent = () => runId === runIdRef.current && isMounted();
    setError(null);
    setResult(null);
    setPhase("preparing");
    setSecondsRemaining(0);
    setPhaseProgress(0);

    const acquire = async () => {
      const mediaDevices =
        typeof navigator === "undefined"
          ? undefined
          : (navigator as Navigator & { mediaDevices?: MediaDevices })
              .mediaDevices;

      if (typeof mediaDevices?.getUserMedia !== "function") {
        if (isCurrent()) {
          failCaptureRef.current(
            t`Audio recording is not supported in this browser.`,
          );
        }
        return;
      }
      if (
        typeof AudioContext === "undefined" ||
        typeof AudioWorkletNode === "undefined"
      ) {
        if (isCurrent()) {
          failCaptureRef.current(
            t`Audio analysis is not supported in this browser.`,
          );
        }
        return;
      }

      let stream: MediaStream;
      try {
        stream = await mediaDevices.getUserMedia({
          audio: {
            ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: { ideal: 1 },
            // Do NOT request a 16 kHz capture rate. WebKit mishandles a
            // forced low rate (cosmetically reports it, then under-delivers /
            // glitches → robotic, time-stretched audio). Capture at the
            // device-native rate and downsample to the canonical 16 kHz in
            // `resampleMonoFloat32ToPcm16` instead.
          },
        });
      } catch (err) {
        if (isCurrent()) {
          failCaptureRef.current(mapGetUserMediaError(err));
        }
        return;
      }

      // Superseded or unmounted while awaiting the prompt — drop the stream.
      if (!isCurrent()) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      const track = stream.getAudioTracks()[0];
      setActiveDeviceLabel(track.label || null);
      // A stream is now live — notify so the device list can re-enumerate
      // and pick up real labels (the WebKit/Safari label-visibility fix).
      onStreamActiveRef.current?.();

      // Run the context at the device-native rate (no `{ sampleRate }` pin):
      // forcing a low rate on WebKit produces glitchy, under-delivered audio.
      // We read the actual rate back below and downsample to 16 kHz ourselves.
      // Create synchronously + fire-and-forget resume() (do NOT await/gate on
      // "running": Chrome can hand back a still-suspended context, which then
      // never produces worklet frames). Frames flow once it wakes; the
      // sample-clock phases advance on delivered frames and the wall-clock
      // backstop covers a context that never wakes.
      let audioContext: AudioContext;
      try {
        audioContext = new AudioContext();
        if (audioContext.state === "suspended") {
          void audioContext.resume();
        }
        await audioContext.audioWorklet.addModule(audioDictationWorkletUrl);
      } catch {
        if (isCurrent()) {
          failCaptureRef.current(t`Could not start the microphone check.`);
        } else {
          stream.getTracks().forEach((track) => track.stop());
        }
        return;
      }

      if (!isCurrent()) {
        stream.getTracks().forEach((track) => track.stop());
        void audioContext.close();
        return;
      }

      // Authoritative rate: what the context actually runs at (WebKit may
      // ignore the requested rate). Everything downstream — phase targets,
      // analysis, replay, transcript — is keyed off this one value.
      const sampleRate = audioContext.sampleRate;
      sampleRateRef.current = sampleRate;
      settleTargetSamplesRef.current = Math.round(
        (SETTLE_MS / 1000) * sampleRate,
      );
      quietTargetSamplesRef.current = Math.round((quietMs / 1000) * sampleRate);
      readTargetSamplesRef.current = Math.round((readMs / 1000) * sampleRate);

      logCaptureContextReady({
        deviceId,
        trackSampleRate: track.getSettings().sampleRate,
        contextSampleRate: sampleRate,
        contextState: audioContext.state,
      });

      const source = audioContext.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(
        audioContext,
        AUDIO_DICTATION_WORKLET_PROCESSOR_NAME,
      );
      worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
        handleFrameRef.current(event.data);
      };
      source.connect(worklet);
      // The worklet has no audible output; do NOT connect to destination
      // (that would echo the mic to the speakers). A worklet runs without a
      // destination connection as long as the source feeds it.

      audioContextRef.current = audioContext;
      sourceRef.current = source;
      workletRef.current = worklet;

      // Begin counting: settle (discard warm-up) → quiet → reading, all on
      // the sample clock inside `handleFrame`.
      chunksRef.current = [];
      totalSamplesRef.current = 0;
      settleSamplesRef.current = 0;
      speechStartSampleRef.current = 0;
      deliveredSamplesRef.current = 0;
      captureStartedAtRef.current = window.performance.now();
      captureContextStartRef.current = audioContext.currentTime;
      stageRef.current = "settling";
      startCountdownLoop();

      // Frame-independent stall guard: if the sample clock never reaches the
      // end (frames stop flowing), surface a clear error instead of hanging.
      const backstopMs =
        (SETTLE_MS + quietMs + readMs) * CAPTURE_BACKSTOP_FACTOR +
        CAPTURE_BACKSTOP_FLOOR_MS;
      backstopTimeoutRef.current = window.setTimeout(() => {
        if (runId === runIdRef.current && stageRef.current !== "done") {
          failCaptureRef.current(
            t`Could not capture audio from the microphone. Please try again.`,
          );
        }
      }, backstopMs);
    };

    void acquire();
  }, [
    deviceId,
    isMounted,
    mapGetUserMediaError,
    quietMs,
    readMs,
    startCountdownLoop,
    teardown,
  ]);

  const cancel = useCallback(() => {
    teardown();
    if (isMounted()) {
      setPhase("idle");
      setSecondsRemaining(0);
      setPhaseProgress(0);
      setResult(null);
      setError(null);
      setActiveDeviceLabel(null);
    }
  }, [isMounted, teardown]);

  const reset = useCallback(() => {
    teardown();
    if (isMounted()) {
      setPhase("idle");
      setSecondsRemaining(0);
      setPhaseProgress(0);
      setResult(null);
      setError(null);
    }
  }, [isMounted, teardown]);

  return {
    phase,
    secondsRemaining,
    phaseProgress,
    error,
    result,
    activeDeviceLabel,
    start,
    cancel,
    reset,
  };
}
