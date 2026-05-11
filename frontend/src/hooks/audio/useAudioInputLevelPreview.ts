import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMountedState } from "react-use";

import {
  AUDIO_BARS_COUNT,
  getAudioLevelBarsFromTimeDomainData,
} from "./audio-pcm-codec";

const PREVIEW_SAMPLE_RATE_HZ = 16_000;

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
}: UseAudioInputLevelPreviewOptions): AudioInputLevelPreviewState {
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
  const isMounted = useMountedState();

  const stop = useCallback(({ resetBars }: { resetBars: boolean }) => {
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
  }, [isMounted]);

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
            sampleRate: { ideal: PREVIEW_SAMPLE_RATE_HZ },
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

      const audioContext = new AudioContext();
      // Safari may start the context suspended even after a user gesture; a
      // resume() call inside the same async chain wakes it without affecting
      // browsers where the context is already running.
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
        setBars(getAudioLevelBarsFromTimeDomainData(levelData));
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
