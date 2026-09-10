import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAudioInputDeviceStore } from "@/state/audioInputDeviceStore";

export type AudioInputDeviceOption = {
  deviceId: string;
  label: string;
};

/**
 * `navigator.mediaDevices` is non-optional in the DOM lib but absent in
 * non-secure contexts, SSR, and some embedded webviews — so narrow it
 * defensively in one place rather than repeating the guard at every call.
 */
function getMediaDevices(): MediaDevices | undefined {
  if (typeof navigator === "undefined") {
    return undefined;
  }
  return (navigator as Navigator & { mediaDevices?: MediaDevices })
    .mediaDevices;
}

export function useAudioInputDevicePreference({
  enabled = true,
}: { enabled?: boolean } = {}) {
  const selectedAudioInputDeviceId = useAudioInputDeviceStore(
    (state) => state.selectedDeviceId,
  );
  const selectedAudioInputDeviceLabel = useAudioInputDeviceStore(
    (state) => state.selectedDeviceLabel,
  );
  const setSelectedDeviceInStore = useAudioInputDeviceStore(
    (state) => state.setSelectedDevice,
  );

  const [audioInputDevices, setAudioInputDevices] = useState<
    AudioInputDeviceOption[]
  >([]);
  const [isLoadingAudioInputDevices, setIsLoadingAudioInputDevices] =
    useState(false);
  const [audioInputDeviceError, setAudioInputDeviceError] = useState<
    string | null
  >(null);
  // True once enumeration returns at least one real (non-empty) device
  // label. On WebKit/Safari, `enumerateDevices()` returns empty labels
  // until a `getUserMedia` stream is active, so this stays false until the
  // user runs the mic test / quality check and we re-enumerate while that
  // stream is live. Consumers use it to show a "start the test to see
  // device names" hint and to know labels are still placeholders.
  const [hasResolvedLabels, setHasResolvedLabels] = useState(false);
  // Pre-permission enumeration is one placeholder with an empty deviceId,
  // so a stored id cannot be judged against it.
  const [hasResolvedDeviceIds, setHasResolvedDeviceIds] = useState(false);
  // True when the on-demand label reveal (see `revealAudioInputDeviceLabels`)
  // was blocked because the user denied the microphone permission prompt.
  // Drives a tailored, non-error hint — the device list still works on the
  // system default; only the human-readable names are unavailable.
  const [labelRevealDenied, setLabelRevealDenied] = useState(false);

  const setSelectedAudioInputDevice = useCallback(
    (deviceId: string, label = "") => {
      setSelectedDeviceInStore(deviceId, label);
    },
    [setSelectedDeviceInStore],
  );

  const refreshAudioInputDevices = useCallback(async () => {
    const mediaDevices = getMediaDevices();

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
      let sawRealLabel = false;
      const audioInputs = devices
        .filter((device) => device.kind === "audioinput")
        .map((device, index) => {
          const microphoneIndex = index + 1;
          if (device.label) {
            sawRealLabel = true;
          }

          return {
            deviceId: device.deviceId,
            label: device.label || t`Microphone ${microphoneIndex}`,
          };
        });
      setAudioInputDevices(audioInputs);
      setHasResolvedLabels(sawRealLabel);
      setHasResolvedDeviceIds(
        audioInputs.length > 0 &&
          audioInputs.every((device) => device.deviceId !== ""),
      );
    } catch {
      setAudioInputDevices([]);
      setHasResolvedLabels(false);
      setHasResolvedDeviceIds(false);
      setAudioInputDeviceError(t`Could not load audio input devices.`);
    } finally {
      setIsLoadingAudioInputDevices(false);
    }
  }, []);

  /**
   * Refresh the device list and, when labels are still placeholders, reveal
   * the real names on demand. Call this from an explicit user gesture (the
   * "Refresh devices" button) — never on mount.
   *
   * On WebKit/Safari, `enumerateDevices()` exposes labels only while a
   * capture stream is live, so here we briefly open one, re-enumerate while
   * it is active, then stop it. The clip is never read; the stream exists
   * purely to unlock labels.
   *
   * Cases handled, each degrading gracefully (the list always still works on
   * the system default, only the names may be missing):
   *  - Labels already real (Chrome/Firefox, or a test/quality stream is
   *    live): plain refresh, no stream opened, no permission prompt.
   *  - getUserMedia unsupported: plain refresh.
   *  - Permission denied: keep placeholder names, flag `labelRevealDenied`
   *    so the UI can explain why — not surfaced as a hard error.
   */
  const revealAudioInputDeviceLabels = useCallback(async () => {
    const mediaDevices = getMediaDevices();

    // Already have real names, or no way to open a stream → just refresh.
    // Skipping the stream here also avoids opening a second one when a mic
    // test / quality check is already live (which set `hasResolvedLabels`).
    if (hasResolvedLabels || typeof mediaDevices?.getUserMedia !== "function") {
      await refreshAudioInputDevices();
      return;
    }

    setIsLoadingAudioInputDevices(true);
    setLabelRevealDenied(false);

    let stream: MediaStream | null = null;
    try {
      // Minimal constraints — any live audio stream unlocks the labels.
      stream = await mediaDevices.getUserMedia({ audio: true });
      // Enumerate while the stream is live so labels are populated.
      await refreshAudioInputDevices();
    } catch (error) {
      const name = error instanceof DOMException ? error.name : undefined;
      if (name === "NotAllowedError" || name === "SecurityError") {
        setLabelRevealDenied(true);
      }
      // Keep whatever the list currently is (placeholder names are fine);
      // refresh once more so a denial still reflects any device changes.
      await refreshAudioInputDevices();
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
      setIsLoadingAudioInputDevices(false);
    }
  }, [hasResolvedLabels, refreshAudioInputDevices]);

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
    const mediaDevices = getMediaDevices();
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
    hasResolvedDeviceIds,
    hasResolvedLabels,
    isLoadingAudioInputDevices,
    labelRevealDenied,
    refreshAudioInputDevices,
    revealAudioInputDeviceLabels,
    selectedAudioInputDevice,
    selectedAudioInputDeviceId,
    selectedAudioInputDeviceLabel,
    setSelectedAudioInputDevice,
  };
}
