import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMountedState } from "react-use";

import {
  AUDIO_BARS_COUNT,
  getAudioLevelBarsFromTimeDomainData,
} from "./audio-pcm-codec";

// Live-meter adaptive auto-gain (browser-agnostic): lift a quiet signal so
// the bars stay responsive when raw capture is low (e.g. WebKit with AGC
// off), without touching an already-loud signal. We track a fast-attack /
// slow-release peak envelope of the raw amplitude and boost it toward a
// reference; a loud signal (Chrome) clamps the boost to 1 → visually
// unchanged. This is the live analogue of the replay waveform's static
// peak-normalization, and needs no browser detection (it adapts to the
// signal, never the user-agent).
const METER_REFERENCE_PEAK = 0.2; // raw peak treated as "full scale" for bars
const METER_MAX_GAIN = 8; // cap so a near-silent floor isn't blown up
const METER_SILENCE_PEAK = 0.01; // below this the room is silent → no boost
const METER_ENVELOPE_DECAY = 0.92; // per-frame release (~200 ms @ 60 fps)

function createIdleBars(): number[] {
  return Array.from({ length: AUDIO_BARS_COUNT }, () => 2);
}

export type AudioInputLevelPreviewState = {
  bars: number[];
  isActive: boolean;
  error: string | null;
  activeDeviceId: string | null;
  activeDeviceLabel: string | null;
  /**
   * True when a deviceId was requested but the resolved track reports a
   * different deviceId. With `{ exact: ... }` constraints the browser should
   * reject rather than substitute, so this is a defensive signal — when set,
   * the user's selection did not propagate.
   */
  deviceIdMismatch: boolean;
};

type UseAudioInputLevelPreviewOptions = {
  enabled: boolean;
  /** Selected device id; "" means the browser's default microphone. */
  deviceId: string;
  /**
   * Fired once each time a capture stream successfully opens. Lets the
   * device-list owner re-enumerate while a stream is live so WebKit/Safari
   * exposes real device labels (it returns empty labels with no active
   * stream). Held in a ref internally so passing an unstable callback does
   * not restart capture.
   */
  onStreamActive?: () => void;
};

/**
 * Opens a MediaStream for the given deviceId, drives a 5-bar level meter via
 * AnalyserNode + requestAnimationFrame, and exposes track diagnostics so the
 * caller can confirm the resolved device matches the request. Tears down the
 * stream / AudioContext / RAF on disable, deviceId change, and unmount.
 *
 * This is the analyser-only sibling of `useAudioDictationRecorder` — no
 * ScriptProcessor, no transcription socket, no recording lifecycle.
 */
export function useAudioInputLevelPreview({
  enabled,
  deviceId,
  onStreamActive,
}: UseAudioInputLevelPreviewOptions): AudioInputLevelPreviewState {
  const onStreamActiveRef = useRef(onStreamActive);
  onStreamActiveRef.current = onStreamActive;
  const [bars, setBars] = useState<number[]>(createIdleBars);
  const [error, setError] = useState<string | null>(null);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);
  const [activeDeviceLabel, setActiveDeviceLabel] = useState<string | null>(
    null,
  );
  const [isActive, setIsActive] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const levelDataRef = useRef<Uint8Array | null>(null);
  const rafRef = useRef<number | null>(null);
  // Running peak envelope for the adaptive auto-gain (reset on each start).
  const peakEnvelopeRef = useRef(0);
  const isMounted = useMountedState();

  const stop = useCallback(
    ({ resetBars }: { resetBars: boolean }) => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      analyserRef.current?.disconnect();
      sourceRef.current?.disconnect();
      if (audioContextRef.current) {
        void audioContextRef.current.close();
        audioContextRef.current = null;
      }
      analyserRef.current = null;
      sourceRef.current = null;
      levelDataRef.current = null;
      peakEnvelopeRef.current = 0;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (!isMounted()) {
        return;
      }
      setIsActive(false);
      setActiveDeviceId(null);
      setActiveDeviceLabel(null);
      if (resetBars) {
        setBars(createIdleBars());
      }
    },
    [isMounted],
  );

  useEffect(() => {
    return () => {
      stop({ resetBars: false });
    };
  }, [stop]);

  useEffect(() => {
    if (!enabled) {
      stop({ resetBars: true });
      setError(null);
      return;
    }

    let cancelled = false;

    const start = async () => {
      stop({ resetBars: true });
      setError(null);

      const mediaDevices =
        typeof navigator === "undefined"
          ? undefined
          : (navigator as Navigator & { mediaDevices?: MediaDevices })
              .mediaDevices;

      if (typeof mediaDevices?.getUserMedia !== "function") {
        setError(t`Audio recording is not supported in this browser.`);
        return;
      }

      if (typeof AudioContext === "undefined") {
        setError(t`Audio analysis is not supported in this browser.`);
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
            // No sampleRate constraint — WebKit mishandles a forced rate; the
            // meter is analyser-only so the native rate is fine.
          },
        });
      } catch (err) {
        if (cancelled || !isMounted()) {
          return;
        }
        const name = err instanceof DOMException ? err.name : undefined;
        if (name === "NotAllowedError" || name === "SecurityError") {
          setError(
            t`Microphone permission denied. Allow access to test the microphone.`,
          );
        } else if (
          name === "NotFoundError" ||
          name === "OverconstrainedError"
        ) {
          setError(
            t`The selected microphone is not available. Refresh the device list and try again.`,
          );
        } else if (name === "NotReadableError") {
          setError(
            t`The microphone is already in use by another application or recording.`,
          );
        } else {
          setError(t`Could not start the microphone test.`);
        }
        return;
      }

      if (cancelled || !isMounted()) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      const track = stream.getAudioTracks()[0];
      const settings = track.getSettings();
      setActiveDeviceId(settings.deviceId ?? null);
      setActiveDeviceLabel(track.label);
      // A stream is now live — notify so the device list can re-enumerate
      // and pick up real labels (the WebKit/Safari label-visibility fix).
      onStreamActiveRef.current?.();

      // Build the graph and start polling IMMEDIATELY. A VU meter must never
      // gate on the context reaching "running": if it starts suspended
      // (Chrome/Safari autoplay), a fire-and-forget resume() wakes it and the
      // rAF picks up real levels once it runs. (An earlier "await
      // running-context" gate could hand back a still-suspended context on
      // Chrome → a permanently flat, silent meter — never do that here.)
      const audioContext = new AudioContext();
      if (audioContext.state === "suspended") {
        void audioContext.resume();
      }
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.65;
      source.connect(analyser);

      audioContextRef.current = audioContext;
      sourceRef.current = source;
      analyserRef.current = analyser;
      levelDataRef.current = new Uint8Array(analyser.fftSize);
      setIsActive(true);

      const tick = () => {
        const analyserNode = analyserRef.current;
        const levelData = levelDataRef.current;
        if (!analyserNode || !levelData || !isMounted()) {
          return;
        }
        analyserNode.getByteTimeDomainData(levelData);

        // Adaptive auto-gain: track a fast-attack / slow-release peak of the
        // raw amplitude and boost quiet signals toward the reference. Loud
        // signals yield gain 1 (clamped), so Chrome is visually unchanged.
        let framePeak = 0;
        for (let index = 0; index < levelData.length; index += 1) {
          const magnitude = Math.abs((levelData[index] - 128) / 128);
          if (magnitude > framePeak) {
            framePeak = magnitude;
          }
        }
        const envelope = Math.max(
          framePeak,
          peakEnvelopeRef.current * METER_ENVELOPE_DECAY,
        );
        peakEnvelopeRef.current = envelope;
        const gain =
          envelope > METER_SILENCE_PEAK
            ? Math.min(
                METER_MAX_GAIN,
                Math.max(1, METER_REFERENCE_PEAK / envelope),
              )
            : 1;

        setBars(getAudioLevelBarsFromTimeDomainData(levelData, gain));
        rafRef.current = window.requestAnimationFrame(tick);
      };
      rafRef.current = window.requestAnimationFrame(tick);
    };

    void start();

    return () => {
      cancelled = true;
      stop({ resetBars: true });
    };
  }, [enabled, deviceId, isMounted, stop]);

  const deviceIdMismatch =
    enabled &&
    deviceId !== "" &&
    activeDeviceId !== null &&
    activeDeviceId !== deviceId;

  return {
    bars,
    isActive,
    error,
    activeDeviceId,
    activeDeviceLabel,
    deviceIdMismatch,
  };
}
