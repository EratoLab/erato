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

import { useAudioInputDeviceStore } from "@/state/audioInputDeviceStore";

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

describe("useAudioInputDevicePreference — stored selection survives list churn", () => {
  const PLACEHOLDER: FakeDevice[] = [
    { kind: "audioinput", deviceId: "", label: "" },
  ];
  const REAL: FakeDevice[] = [
    {
      kind: "audioinput",
      deviceId: "mic-airpods",
      label: "AirPods (Bluetooth)",
    },
    {
      kind: "audioinput",
      deviceId: "mic-builtin",
      label: "Built-in Microphone",
    },
  ];
  let devices: FakeDevice[];
  let deviceChangeListeners: Array<() => void>;

  const fireDeviceChange = () => {
    for (const listener of deviceChangeListeners) listener();
  };

  beforeEach(() => {
    localStorage.clear();
    useAudioInputDeviceStore.setState({
      selectedDeviceId: "",
      selectedDeviceLabel: "",
    });
    devices = REAL;
    deviceChangeListeners = [];
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => ({ getTracks: () => [] })),
        enumerateDevices: vi.fn(async () => devices),
        addEventListener: vi.fn((_type: string, listener: () => void) => {
          deviceChangeListeners.push(listener);
        }),
        removeEventListener: vi.fn(),
      },
    });
  });

  it("keeps a selection made after the permission grant while another instance still holds the pre-permission placeholder", async () => {
    devices = PLACEHOLDER;
    const stale = renderHook(() => useAudioInputDevicePreference());
    await waitFor(() =>
      expect(stale.result.current.audioInputDevices).toHaveLength(1),
    );
    expect(stale.result.current.hasResolvedDeviceIds).toBe(false);

    devices = REAL;
    const prefs = renderHook(() => useAudioInputDevicePreference());
    await waitFor(() =>
      expect(prefs.result.current.hasResolvedDeviceIds).toBe(true),
    );

    act(() => {
      prefs.result.current.setSelectedAudioInputDevice(
        "mic-airpods",
        "AirPods (Bluetooth)",
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(useAudioInputDeviceStore.getState()).toMatchObject({
      selectedDeviceId: "mic-airpods",
      selectedDeviceLabel: "AirPods (Bluetooth)",
    });
    expect(stale.result.current.selectedAudioInputDeviceId).toBe("mic-airpods");
  });

  it("keeps the selection across an enumeration that omits the device", async () => {
    const { result } = renderHook(() => useAudioInputDevicePreference());
    await waitFor(() =>
      expect(result.current.audioInputDevices).toHaveLength(2),
    );
    act(() => {
      result.current.setSelectedAudioInputDevice(
        "mic-airpods",
        "AirPods (Bluetooth)",
      );
    });

    devices = REAL.filter((device) => device.deviceId !== "mic-airpods");
    act(fireDeviceChange);
    await waitFor(() =>
      expect(result.current.audioInputDevices).toHaveLength(1),
    );
    expect(result.current.selectedAudioInputDevice).toBeNull();
    expect(result.current.selectedAudioInputDeviceId).toBe("mic-airpods");

    devices = REAL;
    act(fireDeviceChange);
    await waitFor(() =>
      expect(result.current.selectedAudioInputDevice?.label).toBe(
        "AirPods (Bluetooth)",
      ),
    );
    expect(useAudioInputDeviceStore.getState().selectedDeviceId).toBe(
      "mic-airpods",
    );
  });

  it("drops the stored label together with the id", () => {
    const { result } = renderHook(() => useAudioInputDevicePreference());
    act(() => {
      result.current.setSelectedAudioInputDevice(
        "mic-airpods",
        "AirPods (Bluetooth)",
      );
    });
    act(() => {
      result.current.setSelectedAudioInputDevice("");
    });
    expect(useAudioInputDeviceStore.getState()).toMatchObject({
      selectedDeviceId: "",
      selectedDeviceLabel: "",
    });
  });
});
