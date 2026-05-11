import { renderHook, act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getAudioLevelBarsFromTimeDomainData,
  useAudioDictationRecorder,
} from "../useAudioDictationRecorder";

vi.mock("../useAudioInputDevicePreference", () => ({
  useAudioInputDevicePreference: () => ({ selectedAudioInputDeviceId: "" }),
}));

class MockMediaStreamTrack {
  stop = vi.fn();

  getSettings() {
    return {
      autoGainControl: false,
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
      sampleRate: 16000,
    };
  }
}

class MockMediaStream {
  private readonly track = new MockMediaStreamTrack();

  getTracks() {
    return [this.track];
  }

  getAudioTracks() {
    return [this.track];
  }
}

class MockAnalyserNode {
  fftSize = 256;
  smoothingTimeConstant = 0;

  disconnect = vi.fn();

  getByteTimeDomainData(data: Uint8Array) {
    data.fill(128);
  }
}

class MockGainNode {
  gain = { value: 1 };
  connect = vi.fn();
  disconnect = vi.fn();
}

class MockMediaStreamAudioSourceNode {
  connect = vi.fn();
  disconnect = vi.fn();
}

class MockScriptProcessorNode {
  onaudioprocess: ((event: AudioProcessingEvent) => void) | null = null;
  connect = vi.fn();
  disconnect = vi.fn();
}

const mockProcessors: MockScriptProcessorNode[] = [];

class MockAudioContext {
  sampleRate = 16000;
  state = "running";
  destination = {};

  createMediaStreamSource() {
    return new MockMediaStreamAudioSourceNode();
  }

  createAnalyser() {
    return new MockAnalyserNode();
  }

  createScriptProcessor() {
    const processor = new MockScriptProcessorNode();
    mockProcessors.push(processor);
    return processor;
  }

  createGain() {
    return new MockGainNode();
  }

  close = vi.fn(async () => {
    this.state = "closed";
  });
}

class MockMediaRecorder {
  static instances: MockMediaRecorder[] = [];
  state: "inactive" | "recording" = "inactive";
  onstop: (() => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor() {
    MockMediaRecorder.instances.push(this);
  }

  start = vi.fn(() => {
    this.state = "recording";
  });

  stop = vi.fn(() => {
    this.state = "inactive";
    this.onstop?.();
  });
}

type MockWebSocketEvent = {
  data?: string | ArrayBuffer | Uint8Array;
};

class MockWebSocket {
  static OPEN = 1;
  static instances: MockWebSocket[] = [];
  readyState = MockWebSocket.OPEN;
  sentJsonFrames: Record<string, unknown>[] = [];
  sentBinaryFrames: Uint8Array[] = [];
  closeOnFinish = false;
  private listeners = new Map<
    string,
    Set<(event: MockWebSocketEvent) => void>
  >();

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  addEventListener(
    type: string,
    listener: (event: MockWebSocketEvent) => void,
  ) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(
    type: string,
    listener: (event: MockWebSocketEvent) => void,
  ) {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: string | ArrayBuffer | Uint8Array) {
    if (typeof data === "string") {
      const frame = JSON.parse(data) as Record<string, unknown>;
      this.sentJsonFrames.push(frame);

      if (frame.type === "finish" && this.closeOnFinish) {
        this.close();
      }
      return;
    }

    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.sentBinaryFrames.push(bytes);
  }

  close = vi.fn(() => {
    this.readyState = 3;
    this.emit("close", {});
  });

  emit(type: string, event: MockWebSocketEvent = {}) {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }

  emitJson(frame: Record<string, unknown>) {
    this.emit("message", { data: JSON.stringify(frame) });
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function renderDictationHook(onTranscriptChunk = vi.fn()) {
  return renderHook(() =>
    useAudioDictationRecorder({
      enabled: true,
      maxRecordingDurationSeconds: 1200,
      onTranscriptChunk,
    }),
  );
}

function emitAudioSamples(samples: Float32Array) {
  const processor = mockProcessors.at(-1);
  if (!processor?.onaudioprocess) {
    throw new Error("Script processor was not initialized");
  }

  processor.onaudioprocess({
    inputBuffer: {
      getChannelData: () => samples,
    },
  } as unknown as AudioProcessingEvent);
}

describe("getAudioLevelBarsFromTimeDomainData", () => {
  it("keeps silent input at the minimum waveform height", () => {
    const silence = new Uint8Array(100).fill(128);

    expect(getAudioLevelBarsFromTimeDomainData(silence)).toEqual([
      2, 2, 2, 2, 2,
    ]);
  });

  it("raises bars for spoken waveform amplitude", () => {
    const speechLikeInput = new Uint8Array(
      Array.from({ length: 100 }, (_, index) => (index % 2 === 0 ? 136 : 120)),
    );

    expect(
      getAudioLevelBarsFromTimeDomainData(speechLikeInput).some(
        (height) => height > 2,
      ),
    ).toBe(true);
  });
});

describe("useAudioDictationRecorder", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    MockMediaRecorder.instances.length = 0;
    MockWebSocket.instances.length = 0;
    mockProcessors.length = 0;

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => new MockMediaStream()),
      },
    });

    vi.stubGlobal("AudioContext", MockAudioContext);
    vi.stubGlobal("MediaRecorder", MockMediaRecorder);
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });

  it("prevents duplicate starts while microphone permission is pending", async () => {
    const permission = createDeferred<MockMediaStream>();
    const getUserMedia = vi.fn(() => permission.promise);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
    const { result, unmount } = renderDictationHook();

    act(() => {
      result.current.toggleDictation();
      result.current.toggleDictation();
    });

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    unmount();

    await act(async () => {
      permission.resolve(new MockMediaStream());
      await permission.promise;
    });
  });

  it("clears starting state when the socket closes before session state", async () => {
    const { result } = renderDictationHook();

    await act(async () => {
      result.current.toggleDictation();
    });
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));

    act(() => {
      MockWebSocket.instances[0].emit("open");
    });
    await waitFor(() =>
      expect(MockWebSocket.instances[0].sentJsonFrames).toContainEqual({
        type: "start",
      }),
    );
    act(() => {
      MockWebSocket.instances[0].close();
    });

    await waitFor(() => expect(result.current.isDictationStarting).toBe(false));
    expect(result.current.dictationError).toBe(
      "Audio dictation connection closed.",
    );
  });

  it("buffers samples emitted before session_state and replays them into the first chunk", async () => {
    const { result } = renderDictationHook();

    await act(async () => {
      result.current.toggleDictation();
    });
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    // The audio pipeline is built before the socket handshake awaits, so the
    // script processor exists even though the session isn't ready yet.
    await waitFor(() => expect(mockProcessors).toHaveLength(1));

    // Pre-handshake: feed samples into the pre-session buffer. Nothing
    // should be transmitted because the session isn't constructed yet.
    act(() => {
      emitAudioSamples(new Float32Array(1600).fill(0.2));
    });
    expect(MockWebSocket.instances[0].sentBinaryFrames).toHaveLength(0);

    act(() => {
      MockWebSocket.instances[0].emit("open");
    });
    await waitFor(() =>
      expect(MockWebSocket.instances[0].sentJsonFrames).toContainEqual({
        type: "start",
      }),
    );
    act(() => {
      MockWebSocket.instances[0].emitJson({
        type: "session_state",
        next_chunk_index: 0,
        chunk_duration_ms: 100,
      });
    });

    // The drain + flush in startDictation should produce a first chunk
    // containing the samples captured before session_state arrived.
    await waitFor(() =>
      expect(
        MockWebSocket.instances[0].sentBinaryFrames.length,
      ).toBeGreaterThan(0),
    );
    expect(MockWebSocket.instances[0].sentJsonFrames).toContainEqual(
      expect.objectContaining({ type: "chunk_metadata", chunk_index: 0 }),
    );
  });

  it("clears completing state when the socket closes before completion", async () => {
    const { result } = renderDictationHook();

    await act(async () => {
      result.current.toggleDictation();
    });
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));

    act(() => {
      MockWebSocket.instances[0].emit("open");
    });
    await waitFor(() =>
      expect(MockWebSocket.instances[0].sentJsonFrames).toContainEqual({
        type: "start",
      }),
    );
    act(() => {
      MockWebSocket.instances[0].emitJson({
        type: "session_state",
        next_chunk_index: 0,
        chunk_duration_ms: 100,
      });
    });
    await waitFor(() => expect(result.current.isDictating).toBe(true));

    act(() => {
      emitAudioSamples(new Float32Array(1600).fill(0.1));
    });
    await waitFor(() =>
      expect(
        MockWebSocket.instances[0].sentBinaryFrames.length,
      ).toBeGreaterThan(0),
    );

    MockWebSocket.instances[0].closeOnFinish = true;
    await act(async () => {
      result.current.toggleDictation();
    });

    await waitFor(() =>
      expect(result.current.isDictationCompleting).toBe(false),
    );
    expect(result.current.dictationError).toBe(
      "Audio dictation connection closed.",
    );
  });

  it("does not complete dictation during unmount cleanup", async () => {
    const { result, unmount } = renderDictationHook();

    await act(async () => {
      result.current.toggleDictation();
    });
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    act(() => {
      MockWebSocket.instances[0].emit("open");
    });
    await waitFor(() =>
      expect(MockWebSocket.instances[0].sentJsonFrames).toContainEqual({
        type: "start",
      }),
    );
    act(() => {
      MockWebSocket.instances[0].emitJson({
        type: "session_state",
        next_chunk_index: 0,
        chunk_duration_ms: 100,
      });
    });
    await waitFor(() => expect(result.current.isDictating).toBe(true));

    unmount();

    expect(MockMediaRecorder.instances[0].stop).toHaveBeenCalled();
    expect(MockWebSocket.instances[0].sentJsonFrames).not.toContainEqual(
      expect.objectContaining({ type: "finish" }),
    );
  });
});
