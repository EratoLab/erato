import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAudioInputDeviceStore } from "@/state/audioInputDeviceStore";

export type AudioInputDeviceOption = {
  deviceId: string;
  label: string;
};

export function useAudioInputDevicePreference({
  enabled = true,
}: { enabled?: boolean } = {}) {
  const selectedAudioInputDeviceId = useAudioInputDeviceStore(
    (state) => state.selectedDeviceId,
  );
  const setSelectedDeviceIdInStore = useAudioInputDeviceStore(
    (state) => state.setSelectedDeviceId,
  );

  const [audioInputDevices, setAudioInputDevices] = useState<
    AudioInputDeviceOption[]
  >([]);
  const [isLoadingAudioInputDevices, setIsLoadingAudioInputDevices] =
    useState(false);
  const [audioInputDeviceError, setAudioInputDeviceError] = useState<
    string | null
  >(null);

  const setSelectedAudioInputDeviceId = useCallback(
    (deviceId: string) => {
      setSelectedDeviceIdInStore(deviceId);
    },
    [setSelectedDeviceIdInStore],
  );

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
    if (!enabled) {
      return;
    }

    void refreshAudioInputDevices();

    // Re-enumerate when the user plugs in / unplugs a microphone mid
    // session. Without this, the dropdown stays stale until the user
    // manually clicks "Refresh devices". `devicechange` only fires for
    // device add/remove — not for label availability after permission
    // grant, which is still what the manual refresh button is for.
    const mediaDevices =
      typeof navigator === "undefined"
        ? undefined
        : (navigator as Navigator & { mediaDevices?: MediaDevices })
            .mediaDevices;
    if (typeof mediaDevices?.addEventListener !== "function") {
      return;
    }
    const onDeviceChange = () => {
      void refreshAudioInputDevices();
    };
    mediaDevices.addEventListener("devicechange", onDeviceChange);
    return () => {
      mediaDevices.removeEventListener("devicechange", onDeviceChange);
    };
  }, [enabled, refreshAudioInputDevices]);

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
