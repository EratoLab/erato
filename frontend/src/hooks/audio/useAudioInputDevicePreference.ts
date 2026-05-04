import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useMemo, useState } from "react";

export const AUDIO_INPUT_DEVICE_ID_LOCAL_STORAGE_KEY =
  "erato.audioTranscription.audioInputDeviceId";

export type AudioInputDeviceOption = {
  deviceId: string;
  label: string;
};

function readStoredAudioInputDeviceId(): string {
  try {
    return (
      localStorage.getItem(AUDIO_INPUT_DEVICE_ID_LOCAL_STORAGE_KEY) ?? ""
    ).trim();
  } catch {
    return "";
  }
}

function writeStoredAudioInputDeviceId(deviceId: string) {
  try {
    if (deviceId) {
      localStorage.setItem(AUDIO_INPUT_DEVICE_ID_LOCAL_STORAGE_KEY, deviceId);
      return;
    }

    localStorage.removeItem(AUDIO_INPUT_DEVICE_ID_LOCAL_STORAGE_KEY);
  } catch {
    // Local storage is best-effort; recording should still work with the
    // browser default input when persistence is unavailable.
  }
}

export function useAudioInputDevicePreference() {
  const [selectedAudioInputDeviceId, setSelectedAudioInputDeviceIdState] =
    useState(readStoredAudioInputDeviceId);
  const [audioInputDevices, setAudioInputDevices] = useState<
    AudioInputDeviceOption[]
  >([]);
  const [isLoadingAudioInputDevices, setIsLoadingAudioInputDevices] =
    useState(false);
  const [audioInputDeviceError, setAudioInputDeviceError] = useState<
    string | null
  >(null);

  const setSelectedAudioInputDeviceId = useCallback((deviceId: string) => {
    setSelectedAudioInputDeviceIdState(deviceId);
    writeStoredAudioInputDeviceId(deviceId);
  }, []);

  const refreshAudioInputDevices = useCallback(async () => {
    const mediaDevices =
      typeof navigator === "undefined"
        ? undefined
        : (navigator as Navigator & { mediaDevices?: MediaDevices })
            .mediaDevices;

    if (typeof mediaDevices?.enumerateDevices !== "function") {
      setAudioInputDevices([]);
      setAudioInputDeviceError(
        t`Audio input device selection is not supported in this browser.`,
      );
      return;
    }

    setIsLoadingAudioInputDevices(true);
    setAudioInputDeviceError(null);

    try {
      const devices = await mediaDevices.enumerateDevices();
      const audioInputs = devices
        .filter((device) => device.kind === "audioinput")
        .map((device, index) => {
          const microphoneIndex = index + 1;

          return {
            deviceId: device.deviceId,
            label: device.label || t`Microphone ${microphoneIndex}`,
          };
        });
      setAudioInputDevices(audioInputs);
    } catch {
      setAudioInputDevices([]);
      setAudioInputDeviceError(t`Could not load audio input devices.`);
    } finally {
      setIsLoadingAudioInputDevices(false);
    }
  }, []);

  useEffect(() => {
    void refreshAudioInputDevices();
  }, [refreshAudioInputDevices]);

  const selectedAudioInputDevice = useMemo(
    () =>
      audioInputDevices.find(
        (device) => device.deviceId === selectedAudioInputDeviceId,
      ) ?? null,
    [audioInputDevices, selectedAudioInputDeviceId],
  );

  return {
    audioInputDeviceError,
    audioInputDevices,
    isLoadingAudioInputDevices,
    refreshAudioInputDevices,
    selectedAudioInputDevice,
    selectedAudioInputDeviceId,
    setSelectedAudioInputDeviceId,
  };
}
