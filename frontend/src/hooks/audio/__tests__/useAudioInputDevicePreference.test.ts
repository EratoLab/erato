import { renderHook, act, waitFor } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import { useAudioInputDevicePreference } from "../useAudioInputDevicePreference";

type FakeStream = { getTracks: () => { stop: () => void }[] };
type FakeDevice = { kind: string; deviceId: string; label: string };

/**
 * Models the WebKit/Safari quirk these tests exercise: `enumerateDevices()`
 * returns real device labels only while a capture stream is live. A shared
 * `streamActive` flag flips on in `getUserMedia` and off when the track is
 * stopped, and the enumerate mock reports labels accordingly.
 */
let streamActive = false;
let trackStop: Mock<() => void>;
let getUserMediaMock: Mock<() => Promise<FakeStream>>;
let enumerateDevicesMock: Mock<() => Promise<FakeDevice[]>>;

function installMediaDevices({ alwaysLabeled = false } = {}) {
  streamActive = false;
  trackStop = vi.fn(() => {
    streamActive = false;
  });
  getUserMediaMock = vi.fn(async () => {
    streamActive = true;
    return { getTracks: () => [{ stop: trackStop }] };
  });
  enumerateDevicesMock = vi.fn(async () => {
    const labeled = alwaysLabeled || streamActive;
    return [
      {
        kind: "audioinput",
        deviceId: "mic-a",
        label: labeled ? "Built-in Microphone" : "",
      },
      {
        kind: "audiooutput",
        deviceId: "spk-a",
        label: labeled ? "Speakers" : "",
      },
    ];
  });

  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: getUserMediaMock,
      enumerateDevices: enumerateDevicesMock,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useAudioInputDevicePreference — revealAudioInputDeviceLabels", () => {
  beforeEach(() => {
    installMediaDevices();
  });

  it("opens a brief stream to reveal labels when they start out empty, then stops it", async () => {
    const { result } = renderHook(() => useAudioInputDevicePreference());

    await waitFor(() =>
      expect(result.current.audioInputDevices).toHaveLength(1),
    );
    // WebKit-style: no stream yet → placeholder label, flag false.
    expect(result.current.hasResolvedLabels).toBe(false);
    expect(result.current.audioInputDevices[0].label).not.toBe(
      "Built-in Microphone",
    );

    await act(async () => {
      await result.current.revealAudioInputDeviceLabels();
    });

    expect(getUserMediaMock).toHaveBeenCalledTimes(1);
    expect(result.current.hasResolvedLabels).toBe(true);
    expect(result.current.audioInputDevices[0].label).toBe(
      "Built-in Microphone",
    );
    // The temporary stream must always be released.
    expect(trackStop).toHaveBeenCalledTimes(1);
    expect(result.current.labelRevealDenied).toBe(false);
  });

  it("does not open a stream when labels are already resolved", async () => {
    installMediaDevices({ alwaysLabeled: true });
    const { result } = renderHook(() => useAudioInputDevicePreference());

    await waitFor(() => expect(result.current.hasResolvedLabels).toBe(true));

    await act(async () => {
      await result.current.revealAudioInputDeviceLabels();
    });

    // Chrome/Firefox already expose labels → no permission prompt.
    expect(getUserMediaMock).not.toHaveBeenCalled();
    expect(result.current.audioInputDevices[0].label).toBe(
      "Built-in Microphone",
    );
  });

  it("flags a denied permission without raising a hard error", async () => {
    const { result } = renderHook(() => useAudioInputDevicePreference());
    await waitFor(() =>
      expect(result.current.audioInputDevices).toHaveLength(1),
    );

    getUserMediaMock.mockImplementationOnce(() =>
      Promise.reject(new DOMException("denied", "NotAllowedError")),
    );

    await act(async () => {
      await result.current.revealAudioInputDeviceLabels();
    });

    expect(result.current.labelRevealDenied).toBe(true);
    expect(result.current.hasResolvedLabels).toBe(false);
    // The list stays usable (system default) and no error Alert is shown.
    expect(result.current.audioInputDeviceError).toBeNull();
    expect(result.current.audioInputDevices).toHaveLength(1);
    expect(trackStop).not.toHaveBeenCalled();
  });
});
