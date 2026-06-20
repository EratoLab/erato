import { renderHook, act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getAudioLevelBarsFromTimeDomainData } from "../audio-pcm-codec";
import { useAudioDictationRecorder } from "../useAudioDictationRecorder";

vi.mock("../useAudioInputDevicePreference", () => ({
  useAudioInputDevicePreference: () => ({ selectedAudioInputDeviceId: "" }),
}));

vi.mock("../audio-dictation-worklet.ts?worker&url", () => ({
  default: "blob:mock-audio-dictation-worklet",
}));

const vadMock = vi.hoisted(() => {
  type Listener = (event: {
    type: string;
    timestampMs?: number;
    audio?: Float32Array;
  }) => void;

  const engines: {
    listeners: Listener[];
    acceptedFrames: unknown[];
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    acceptFrame: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
    emit: (event: Parameters<Listener>[0]) => void;
  }[] = [];

  const createRicky0123VadEngine = vi.fn(() => {
    const engine = {
      listeners: [] as Listener[],
      acceptedFrames: [] as unknown[],
      start: vi.fn(async () => undefined),
      stop: vi.fn(),
      destroy: vi.fn(),
      acceptFrame: vi.fn(async (frame: unknown) => {
        engine.acceptedFrames.push(frame);
      }),
      subscribe: vi.fn((listener: Listener) => {
        engine.listeners.push(listener);
        return () => {
          engine.listeners = engine.listeners.filter(
            (existingListener) => existingListener !== listener,
          );
        };
      }),
      emit: (event: Parameters<Listener>[0]) => {
        engine.listeners.forEach((listener) => listener(event));
      },
    };
    engines.push(engine);
    return engine;
  });

  return {
    engines,
    createRicky0123VadEngine,
  };
});

vi.mock("@/lib/voice-runtime", () => ({
  createRicky0123VadEngine: vadMock.createRicky0123VadEngine,
}));

class MockMediaStreamTrack extends EventTarget {
  // Extends EventTarget so the ERMAIN-390 device-loss watchdog can attach
  // its `ended`/`mute`/`unmute` listeners.
  readyState: MediaStreamTrackState = "live";
  muted = false;
  stop = vi.fn(() => {
    this.readyState = "ended";
  });

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

class MockMessagePort {
  onmessage: ((event: MessageEvent<Float32Array>) => void) | null = null;
  postMessage = vi.fn();
}

class MockAudioWorkletNode {
  static instances: MockAudioWorkletNode[] = [];
  port = new MockMessagePort();
  connect = vi.fn();
  disconnect = vi.fn();

  constructor(
    public readonly context: unknown,
    public readonly name: string,
  ) {
    MockAudioWorkletNode.instances.push(this);
  }
}

class MockAudioWorklet {
  addModule = vi.fn(async () => undefined);
}

class MockAudioContext {
  sampleRate = 16000;
  state = "running";
  destination = {};
  audioWorklet = new MockAudioWorklet();

  createMediaStreamSource() {
    return new MockMediaStreamAudioSourceNode();
  }

  createAnalyser() {
    return new MockAnalyserNode();
  }

  createGain() {
    return new MockGainNode();
  }

  resume = vi.fn(async () => {
    this.state = "running";
  });

  suspend = vi.fn(async () => {
    this.state = "suspended";
  });

  close = vi.fn(async () => {
    this.state = "closed";
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

function renderDictationHook(
  onTranscriptChunk = vi.fn(),
  options?: {
    vadAutoStopEnabled?: boolean;
    onVadAutoStop?: () => void;
  },
) {
  return renderHook(() =>
    useAudioDictationRecorder({
      enabled: true,
      maxRecordingDurationSeconds: 1200,
      onTranscriptChunk,
      vadAutoStopEnabled: options?.vadAutoStopEnabled,
      onVadAutoStop: options?.onVadAutoStop,
    }),
  );
}

function emitAudioSamples(samples: Float32Array) {
  const processor = MockAudioWorkletNode.instances.at(-1);
  if (!processor?.port.onmessage) {
    throw new Error("Audio worklet node was not initialized");
  }

  processor.port.onmessage({ data: samples } as MessageEvent<Float32Array>);
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
    MockWebSocket.instances.length = 0;
    MockAudioWorkletNode.instances.length = 0;
    vadMock.engines.length = 0;
    vadMock.createRicky0123VadEngine.mockClear();

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => new MockMediaStream()),
      },
    });

    vi.stubGlobal("AudioContext", MockAudioContext);
    vi.stubGlobal("AudioWorkletNode", MockAudioWorkletNode);
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
        mode: "dictation",
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
    await waitFor(() => expect(MockAudioWorkletNode.instances).toHaveLength(1));

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
        mode: "dictation",
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
        mode: "dictation",
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
        mode: "dictation",
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

    // Unmount must close the socket without going through the completion
    // flow — no "finish" control frame should be sent. The dictation hook
    // no longer instantiates a MediaRecorder, so there is no recorder to
    // assert against; the WebSocket frame list is the source of truth.
    expect(MockWebSocket.instances[0].sentJsonFrames).not.toContainEqual(
      expect.objectContaining({ type: "finish" }),
    );
  });

  it("feeds audio frames to VAD and completes dictation on VAD speech_end", async () => {
    const onVadAutoStop = vi.fn();
    const { result } = renderDictationHook(vi.fn(), {
      vadAutoStopEnabled: true,
      onVadAutoStop,
    });

    await act(async () => {
      result.current.toggleDictation();
    });
    await waitFor(() => expect(vadMock.engines).toHaveLength(1));
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));

    act(() => {
      MockWebSocket.instances[0].emit("open");
    });
    await waitFor(() =>
      expect(MockWebSocket.instances[0].sentJsonFrames).toContainEqual({
        mode: "dictation",
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
      expect(vadMock.engines[0].acceptFrame).toHaveBeenCalled(),
    );

    act(() => {
      vadMock.engines[0].emit({
        type: "speech_end",
        timestampMs: Date.now(),
        audio: new Float32Array(1600),
      });
    });

    expect(onVadAutoStop).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(MockWebSocket.instances[0].sentJsonFrames).toContainEqual({
        type: "finish",
      }),
    );

    act(() => {
      MockWebSocket.instances[0].emitJson({ type: "completed" });
    });
    await waitFor(() => expect(result.current.isDictating).toBe(false));
    // The engine is kept warm across sessions: teardown only stop()s it
    // so the loaded ONNX/WASM session survives; destroy() is reserved
    // for unmount.
    expect(vadMock.engines[0].stop).toHaveBeenCalled();
    expect(vadMock.engines[0].destroy).not.toHaveBeenCalled();
  });

  it("reuses the warm VAD engine across sessions and destroys it on unmount", async () => {
    const { result, unmount } = renderDictationHook(vi.fn(), {
      vadAutoStopEnabled: true,
    });

    await act(async () => {
      result.current.toggleDictation();
    });
    await waitFor(() => expect(vadMock.engines).toHaveLength(1));
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));

    act(() => {
      MockWebSocket.instances[0].emit("open");
    });
    await waitFor(() =>
      expect(MockWebSocket.instances[0].sentJsonFrames).toContainEqual({
        mode: "dictation",
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

    await act(async () => {
      result.current.toggleDictation();
    });
    act(() => {
      MockWebSocket.instances[0].emitJson({ type: "completed" });
    });
    await waitFor(() =>
      expect(result.current.isDictationCompleting).toBe(false),
    );
    expect(vadMock.engines[0].stop).toHaveBeenCalled();

    // Second session: the SAME engine instance is re-started instead of
    // a new one being created (no second model load).
    await act(async () => {
      result.current.toggleDictation();
    });
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(2));
    expect(vadMock.engines).toHaveLength(1);
    expect(vadMock.engines[0].start).toHaveBeenCalledTimes(2);
    expect(vadMock.createRicky0123VadEngine).toHaveBeenCalledTimes(1);

    unmount();
    expect(vadMock.engines[0].destroy).toHaveBeenCalled();
  });
});
