import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installAudioCaptureAccessPolicy } from "../audioCaptureAccess";
import { useAudioInputDevicePreference } from "../useAudioInputDevicePreference";
import { useAudioInputLevelPreview } from "../useAudioInputLevelPreview";
import { useGuidedAudioCapture } from "../useGuidedAudioCapture";

let dispose: () => void;
let deny: (error: Error) => void;
const getUserMedia = vi.fn();
const beforeCapture = vi.fn();
beforeEach(() => {
  getUserMedia.mockReset();
  beforeCapture.mockImplementation(
    () =>
      new Promise<void>((_resolve, reject) => {
        deny = reject;
      }),
  );
  dispose = installAudioCaptureAccessPolicy({
    beforeCapture,
    canEnumerateDevices: () => false,
  });
  vi.stubGlobal("AudioContext", vi.fn());
  vi.stubGlobal("AudioWorkletNode", vi.fn());
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia, enumerateDevices: vi.fn(async () => []) },
  });
});
afterEach(() => {
  cleanup();
  dispose();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function rejectConsent() {
  expect(beforeCapture).toHaveBeenCalledOnce();
  expect(getUserMedia).not.toHaveBeenCalled();
  await act(async () => {
    deny(new DOMException("Denied", "NotAllowedError"));
  });
  expect(getUserMedia).not.toHaveBeenCalled();
}

describe("microphone settings host consent", () => {
  it("gates device-label discovery without prompting on mount", async () => {
    const { result } = renderHook(() => useAudioInputDevicePreference());
    expect(beforeCapture).not.toHaveBeenCalled();
    let reveal!: Promise<void>;
    act(() => {
      reveal = result.current.revealAudioInputDeviceLabels();
    });
    await rejectConsent();
    await act(async () => {
      await reveal;
    });
    expect(result.current.labelRevealDenied).toBe(true);
    expect(result.current.isLoadingAudioInputDevices).toBe(false);
    expect(navigator.mediaDevices.enumerateDevices).not.toHaveBeenCalled();
  });

  it("gates the level preview", async () => {
    const { result } = renderHook(() =>
      useAudioInputLevelPreview({ enabled: true, deviceId: "selected" }),
    );
    await rejectConsent();
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.isActive).toBe(false);
  });

  it("gates guided capture", async () => {
    const { result } = renderHook(() =>
      useGuidedAudioCapture({ deviceId: "selected" }),
    );
    act(() => result.current.start());
    await rejectConsent();
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.phase).toBe("error");
  });
});
