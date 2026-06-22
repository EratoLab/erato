import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMountedState } from "react-use";

// `?worker&url` routes the worklet through Vite's worker bundling so it is
// served as a standalone module URL for `audioWorklet.addModule()` — the
// same import the dictation recorder uses (see its header note on why the
// `new URL("./worklet.ts", import.meta.url)` pattern does not work here).
import audioDictationWorkletUrl from "./audio-dictation-worklet.ts?worker&url";

const AUDIO_DICTATION_WORKLET_PROCESSOR_NAME = "audio-dictation-processor";

const DEFAULT_QUIET_MS = 2_000;
const DEFAULT_READ_MS = 4_000;
const CAPTURE_SAMPLE_RATE_HZ = 16_000;

/**
 * Settle window discarded after the mic opens and before the quiet phase
 * begins measuring. The OS/driver warm-up emits zeros (Chromium) or a
 * low-level DC bias (WebKit) that would otherwise pollute the noise-floor
 * baseline. Mirrors the onset detector's calibration philosophy.
 */
const SETTLE_MS = 350;

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
  /** Full captured PCM at `sampleRate` (the AudioContext rate). */
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
};

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
 */
export function useGuidedAudioCapture({
  deviceId,
  quietMs = DEFAULT_QUIET_MS,
  readMs = DEFAULT_READ_MS,
  enabled = true,
  onComplete,
}: UseGuidedAudioCaptureOptions): GuidedCaptureState {
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

  // Accumulated frames and the running sample count. Frames are only pushed
  // while `accumulatingRef` is true (i.e. from the quiet phase onward), so
  // warm-up samples never enter the buffer.
  const chunksRef = useRef<Float32Array[]>([]);
  const totalSamplesRef = useRef(0);
  const accumulatingRef = useRef(false);
  const speechStartSampleRef = useRef(0);

  const timeoutRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const phaseEndsAtRef = useRef(0);
  const phaseDurationRef = useRef(0);
  // Bumped on every start()/cancel()/teardown so a late async acquire from a
  // superseded run can detect it was cancelled and bail.
  const runIdRef = useRef(0);

  const clearTimers = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
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
    accumulatingRef.current = false;
  }, []);

  const teardown = useCallback(() => {
    runIdRef.current += 1;
    clearTimers();
    releaseAudioGraph();
    chunksRef.current = [];
    totalSamplesRef.current = 0;
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
    accumulatingRef.current = false;
    clearTimers();
    const sampleRate =
      audioContextRef.current?.sampleRate ?? CAPTURE_SAMPLE_RATE_HZ;
    const samples = assembleSamples();
    const speechStart = Math.min(speechStartSampleRef.current, samples.length);
    const captured: GuidedCaptureResult = {
      samples,
      sampleRate,
      quietRange: { startSample: 0, endSample: speechStart },
      speechRange: { startSample: speechStart, endSample: samples.length },
    };
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

  const runCountdown = useCallback(() => {
    const tick = () => {
      if (!isMounted()) {
        return;
      }
      const remaining = Math.max(
        0,
        phaseEndsAtRef.current - window.performance.now(),
      );
      setSecondsRemaining(Math.ceil(remaining / 1000));
      setPhaseProgress(
        phaseDurationRef.current > 0
          ? 1 - remaining / phaseDurationRef.current
          : 1,
      );
      if (remaining > 0) {
        rafRef.current = window.requestAnimationFrame(tick);
      }
    };
    rafRef.current = window.requestAnimationFrame(tick);
  }, [isMounted]);

  const beginTimedPhase = useCallback(
    (next: "quiet" | "reading", durationMs: number, onElapsed: () => void) => {
      phaseDurationRef.current = durationMs;
      phaseEndsAtRef.current = window.performance.now() + durationMs;
      if (isMounted()) {
        setPhase(next);
        setSecondsRemaining(Math.ceil(durationMs / 1000));
        setPhaseProgress(0);
      }
      runCountdown();
      timeoutRef.current = window.setTimeout(onElapsed, durationMs);
    },
    [isMounted, runCountdown],
  );

  const beginReading = useCallback(() => {
    speechStartSampleRef.current = totalSamplesRef.current;
    beginTimedPhase("reading", readMs, finish);
  }, [beginTimedPhase, finish, readMs]);

  const beginQuiet = useCallback(() => {
    // Reset the buffer so accumulation starts at the quiet phase (sample 0).
    chunksRef.current = [];
    totalSamplesRef.current = 0;
    accumulatingRef.current = true;
    beginTimedPhase("quiet", quietMs, beginReading);
  }, [beginReading, beginTimedPhase, quietMs]);

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
        if (isMounted() && runId === runIdRef.current) {
          setError(t`Audio recording is not supported in this browser.`);
          setPhase("error");
        }
        return;
      }
      if (
        typeof AudioContext === "undefined" ||
        typeof AudioWorkletNode === "undefined"
      ) {
        if (isMounted() && runId === runIdRef.current) {
          setError(t`Audio analysis is not supported in this browser.`);
          setPhase("error");
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
            sampleRate: { ideal: CAPTURE_SAMPLE_RATE_HZ },
          },
        });
      } catch (err) {
        if (isMounted() && runId === runIdRef.current) {
          setError(mapGetUserMediaError(err));
          setPhase("error");
        }
        return;
      }

      // Superseded or unmounted while awaiting the prompt — drop the stream.
      if (runId !== runIdRef.current || !isMounted()) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      const track = stream.getAudioTracks()[0];
      setActiveDeviceLabel(track.label || null);

      const audioContext = new AudioContext();
      if (audioContext.state === "suspended") {
        void audioContext.resume();
      }
      try {
        await audioContext.audioWorklet.addModule(audioDictationWorkletUrl);
      } catch {
        if (isMounted() && runId === runIdRef.current) {
          releaseAudioGraph();
          setError(t`Could not start the microphone check.`);
          setPhase("error");
        }
        return;
      }

      if (runId !== runIdRef.current || !isMounted()) {
        stream.getTracks().forEach((track) => track.stop());
        void audioContext.close();
        return;
      }

      const source = audioContext.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(
        audioContext,
        AUDIO_DICTATION_WORKLET_PROCESSOR_NAME,
      );
      worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (!accumulatingRef.current) {
          return;
        }
        const frame = event.data;
        chunksRef.current.push(frame);
        totalSamplesRef.current += frame.length;
      };
      source.connect(worklet);
      // The worklet has no audible output; do NOT connect to destination
      // (that would echo the mic to the speakers). A worklet runs without a
      // destination connection as long as the source feeds it.

      audioContextRef.current = audioContext;
      sourceRef.current = source;
      workletRef.current = worklet;

      // Discard the warm-up window, then begin measuring the noise floor.
      timeoutRef.current = window.setTimeout(() => {
        if (runId === runIdRef.current && isMounted()) {
          beginQuiet();
        }
      }, SETTLE_MS);
    };

    void acquire();
  }, [
    beginQuiet,
    deviceId,
    isMounted,
    mapGetUserMediaError,
    releaseAudioGraph,
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
