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

  // Auto-clear a stale stored deviceId. Whenever a fresh enumeration
  // produces a non-empty device list (initial load, devicechange,
  // manual refresh) and our persisted `selectedAudioInputDeviceId`
  // isn't in it, drop the selection so the next `getUserMedia` call
  // falls back to the system default instead of throwing
  // `OverconstrainedError`. Triggers on Bluetooth disconnect, USB
  // unplug, browser-side deviceId rotation, profile changes, etc.
  // We guard on `audioInputDevices.length > 0` so a pre-permission
  // enumeration (which returns an empty list on some browsers)
  // doesn't wipe a still-valid selection.
  useEffect(() => {
    if (!selectedAudioInputDeviceId) return;
    if (audioInputDevices.length === 0) return;
    const stillAvailable = audioInputDevices.some(
      (device) => device.deviceId === selectedAudioInputDeviceId,
    );
    if (!stillAvailable) {
      setSelectedAudioInputDeviceId("");
    }
  }, [
    audioInputDevices,
    selectedAudioInputDeviceId,
    setSelectedAudioInputDeviceId,
  ]);

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
