import { renderHook, act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAudioInputDeviceStore } from "@/state/audioInputDeviceStore";

import { getAudioLevelBarsFromTimeDomainData } from "../audio-pcm-codec";
import { installAudioCaptureAccessPolicy } from "../audioCaptureAccess";
import {
  resolveEndOfTurnSilenceMs,
  useAudioDictationRecorder,
} from "../useAudioDictationRecorder";

vi.mock("../audio-dictation-worklet.ts?worker&url", () => ({
  default: "blob:mock-audio-dictation-worklet",
}));

const vadMock = vi.hoisted(() => {
  type Listener = (event: {
    type: string;
    timestampMs?: number;
    audio?: Float32Array;
    frame?: { samples: Float32Array; sampleRate: number };
    probabilities?: { isSpeech: number; notSpeech: number };
  }) => void;

  const engines: {
    listeners: Listener[];
    acceptedFrames: unknown[];
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    reset: ReturnType<typeof vi.fn>;
    acceptFrame: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
    emit: (event: Parameters<Listener>[0]) => void;
  }[] = [];

  const createRicky0123VadEngine = vi.fn((_options?: unknown) => {
    const engine = {
      listeners: [] as Listener[],
      acceptedFrames: [] as unknown[],
      start: vi.fn(async () => undefined),
      stop: vi.fn(),
      destroy: vi.fn(),
      reset: vi.fn(),
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
    mode?: "dictation" | "conversational";
    endOfTurnSilenceMs?: number;
  },
) {
  return renderHook(() =>
    useAudioDictationRecorder({
      enabled: true,
      mode: options?.mode,
      maxRecordingDurationSeconds: 1200,
      onTranscriptChunk,
      vadAutoStopEnabled: options?.vadAutoStopEnabled,
      onVadAutoStop: options?.onVadAutoStop,
      endOfTurnSilenceMs: options?.endOfTurnSilenceMs,
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
    useAudioInputDeviceStore.setState({
      selectedDeviceId: "",
      selectedDeviceLabel: "",
    });

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

  it.each(["dictation", "conversational"] as const)(
    "waits for host consent and returns to idle on denial in %s mode",
    async (mode) => {
      let deny!: (error: Error) => void;
      const beforeCapture = vi.fn(
        () =>
          new Promise<void>((_resolve, reject) => {
            deny = reject;
          }),
      );
      const dispose = installAudioCaptureAccessPolicy({
        beforeCapture,
        canEnumerateDevices: () => false,
      });
      const { result, unmount } = renderHook(() =>
        useAudioDictationRecorder({
          enabled: true,
          mode,
          maxRecordingDurationSeconds: 1200,
          onTranscriptChunk: vi.fn(),
        }),
      );
      try {
        act(() => result.current.toggleDictation());
        expect(beforeCapture).toHaveBeenCalledOnce();
        expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
        await act(async () => {
          deny(new DOMException("Denied", "NotAllowedError"));
        });
        await waitFor(() => expect(result.current.dictationError).toBeTruthy());
        expect(result.current.isDictating).toBe(false);
        expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
      } finally {
        unmount();
        dispose();
      }
    },
  );

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

  it("falls back to the system default for the session when the stored microphone cannot be opened", async () => {
    useAudioInputDeviceStore.setState({
      selectedDeviceId: "mic-airpods",
      selectedDeviceLabel: "AirPods (Bluetooth)",
    });
    const getUserMedia = vi
      .fn<
        (constraints: MediaStreamConstraints) => Promise<MockMediaStream>
      >(async () => new MockMediaStream())
      .mockRejectedValueOnce(new DOMException("gone", "OverconstrainedError"));
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
    const { result } = renderDictationHook();

    await act(async () => {
      result.current.toggleDictation();
    });
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));

    expect(getUserMedia.mock.calls[0][0]).toMatchObject({
      audio: { deviceId: { exact: "mic-airpods" } },
    });
    expect(getUserMedia.mock.calls[1][0].audio).not.toHaveProperty("deviceId");
    expect(useAudioInputDeviceStore.getState().selectedDeviceId).toBe(
      "mic-airpods",
    );
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

  it.each([
    [undefined, 1800],
    [1200, 1200],
    [100, 1800],
  ])(
    "ends a conversational turn after the configured silence (%s ms → %s ms)",
    async (configured, expected) => {
      const { result } = renderDictationHook(vi.fn(), {
        mode: "conversational",
        vadAutoStopEnabled: true,
        endOfTurnSilenceMs: configured,
      });

      await act(async () => {
        result.current.toggleDictation();
      });
      await waitFor(() =>
        expect(vadMock.createRicky0123VadEngine).toHaveBeenCalledTimes(1),
      );
      expect(vadMock.createRicky0123VadEngine).toHaveBeenCalledWith(
        expect.objectContaining({ redemptionMs: expected }),
      );
    },
  );
});

describe("useAudioDictationRecorder over the voice", () => {
  const SAMPLES_PER_SECOND = 16000;

  beforeEach(() => {
    vi.restoreAllMocks();
    MockWebSocket.instances.length = 0;
    MockAudioWorkletNode.instances.length = 0;
    vadMock.engines.length = 0;
    vadMock.createRicky0123VadEngine.mockClear();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => new MockMediaStream()) },
    });
    vi.stubGlobal("AudioContext", MockAudioContext);
    vi.stubGlobal("AudioWorkletNode", MockAudioWorkletNode);
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });

  function renderOverVoice(voiceSpeaking = true, minSpeechMs = 500) {
    const callbacks = {
      onSpeechOverVoice: vi.fn(),
      onVoiceLowered: vi.fn(),
      onVadAutoStop: vi.fn(),
      onTranscriptChunk: vi.fn(),
    };
    const hook = renderHook(
      ({ speaking }: { speaking: boolean }) =>
        useAudioDictationRecorder({
          enabled: true,
          mode: "conversational",
          maxRecordingDurationSeconds: 1200,
          onTranscriptChunk: callbacks.onTranscriptChunk,
          vadAutoStopEnabled: true,
          onVadAutoStop: callbacks.onVadAutoStop,
          voiceSpeaking: speaking,
          overVoiceMinSpeechMs: minSpeechMs,
          onSpeechOverVoice: callbacks.onSpeechOverVoice,
          onVoiceLowered: callbacks.onVoiceLowered,
        }),
      { initialProps: { speaking: voiceSpeaking } },
    );
    return { ...hook, ...callbacks };
  }

  /** `ms` of detector frames at `probability`, 32 ms each like Silero v5. */
  function emitFrames(probability: number, ms: number) {
    for (let at = 0; at < ms; at += 32) {
      vadMock.engines[0].emit({
        type: "frame",
        frame: { samples: new Float32Array(512), sampleRate: 16000 },
        probabilities: { isSpeech: probability, notSpeech: 1 - probability },
      });
    }
  }

  async function startHeld(hook: ReturnType<typeof renderOverVoice>) {
    await act(async () => {
      hook.result.current.toggleDictation();
    });
    await waitFor(() =>
      expect(hook.result.current.isListeningOverVoice).toBe(true),
    );
  }

  async function openSession() {
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    act(() => {
      MockWebSocket.instances[0].emit("open");
    });
    await waitFor(() =>
      expect(MockWebSocket.instances[0].sentJsonFrames).toContainEqual(
        expect.objectContaining({ type: "start" }),
      ),
    );
    act(() => {
      MockWebSocket.instances[0].emitJson({
        type: "session_state",
        next_chunk_index: 0,
        chunk_duration_ms: 100,
      });
    });
  }

  const sentSamples = () =>
    MockWebSocket.instances[0].sentBinaryFrames.map((frame, index) =>
      // The first chunk is a WAV file: its 44-byte header is not audio.
      index === 0 ? frame.length - 44 : frame.length,
    );

  it("asks for echo cancellation and sends nothing while it waits over the voice", async () => {
    const hook = renderOverVoice();
    await startHeld(hook);

    expect(
      vi.mocked(navigator.mediaDevices.getUserMedia).mock.calls[0][0],
    ).toMatchObject({ audio: { echoCancellation: true } });
    act(() => {
      emitAudioSamples(new Float32Array(SAMPLES_PER_SECOND).fill(0.2));
    });
    expect(MockWebSocket.instances).toHaveLength(0);
    expect(hook.result.current.isDictationStarting).toBe(true);
  });

  it("keeps today's microphone and session when the voice is quiet", async () => {
    const hook = renderOverVoice(false);
    await act(async () => {
      hook.result.current.toggleDictation();
    });
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));

    expect(
      vi.mocked(navigator.mediaDevices.getUserMedia).mock.calls[0][0],
    ).toMatchObject({ audio: { echoCancellation: false } });
    expect(hook.result.current.isListeningOverVoice).toBe(false);
  });

  it("lowers the voice for a short sound and restores it, without stopping it or ending a turn", async () => {
    const hook = renderOverVoice();
    await startHeld(hook);

    act(() => {
      vadMock.engines[0].emit({ type: "speech_start", timestampMs: 0 });
      emitFrames(0.95, 320);
    });
    expect(hook.onVoiceLowered).toHaveBeenLastCalledWith(true);
    act(() => {
      emitFrames(0.1, 200);
      vadMock.engines[0].emit({
        type: "speech_end",
        timestampMs: 0,
        audio: new Float32Array(1),
      });
    });

    expect(hook.onVoiceLowered).toHaveBeenLastCalledWith(false);
    expect(hook.onSpeechOverVoice).not.toHaveBeenCalled();
    expect(hook.onVadAutoStop).not.toHaveBeenCalled();
    expect(MockWebSocket.instances).toHaveLength(0);
    expect(hook.result.current.isListeningOverVoice).toBe(true);
  });

  it("ignores speech the detector is unsure of, as the voice's own echo", async () => {
    const hook = renderOverVoice();
    await startHeld(hook);

    act(() => {
      emitFrames(0.6, 3000);
    });

    expect(hook.onVoiceLowered).not.toHaveBeenCalled();
    expect(hook.onSpeechOverVoice).not.toHaveBeenCalled();
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it("makes the voice yield on confirmed speech and transcribes the held moments with what follows", async () => {
    const hook = renderOverVoice();
    await startHeld(hook);

    act(() => {
      // Three seconds over the voice; only the last 1.5 s are kept.
      for (let second = 0; second < 3; second += 1)
        emitAudioSamples(new Float32Array(SAMPLES_PER_SECOND).fill(0.2));
      emitFrames(0.95, 544);
    });
    expect(hook.onSpeechOverVoice).toHaveBeenCalledTimes(1);
    expect(hook.onVoiceLowered).toHaveBeenLastCalledWith(false);

    await openSession();
    await waitFor(() => expect(hook.result.current.isDictating).toBe(true));
    expect(hook.result.current.isListeningOverVoice).toBe(false);
    const held = sentSamples().reduce((sum, bytes) => sum + bytes / 2, 0);
    expect(held).toBe(1.5 * SAMPLES_PER_SECOND);

    // From now on the detector's turn end counts again.
    act(() => {
      vadMock.engines[0].emit({
        type: "speech_end",
        timestampMs: 0,
        audio: new Float32Array(1),
      });
    });
    expect(hook.onVadAutoStop).toHaveBeenCalledTimes(1);
  });

  it("drops what was heard over the voice when the voice ends on its own with nobody speaking, and starts fresh", async () => {
    const hook = renderOverVoice();
    await startHeld(hook);
    act(() => {
      emitAudioSamples(new Float32Array(SAMPLES_PER_SECOND).fill(0.2));
      // A short sound that ended before the voice did.
      emitFrames(0.95, 200);
      emitFrames(0.1, 200);
    });

    hook.rerender({ speaking: false });
    await openSession();
    await waitFor(() => expect(hook.result.current.isDictating).toBe(true));

    expect(hook.onSpeechOverVoice).not.toHaveBeenCalled();
    expect(hook.onVoiceLowered).toHaveBeenLastCalledWith(false);
    expect(vadMock.engines[0].reset).toHaveBeenCalled();
    // Only the 300 ms silence primer is left: three silent chunks.
    await waitFor(() =>
      expect(MockWebSocket.instances[0].sentBinaryFrames).toHaveLength(3),
    );
    const [wav, ...pcm] = MockWebSocket.instances[0].sentBinaryFrames;
    expect(
      [wav.slice(44), ...pcm].every((bytes) => bytes.every((b) => b === 0)),
    ).toBe(true);
    act(() => {
      emitAudioSamples(new Float32Array(1600).fill(0.3));
    });
    await waitFor(() =>
      expect(MockWebSocket.instances[0].sentBinaryFrames).toHaveLength(4),
    );
  });

  it("keeps speech already under way when the voice ends, as the start of the turn", async () => {
    const hook = renderOverVoice();
    await startHeld(hook);
    act(() => {
      emitAudioSamples(new Float32Array(SAMPLES_PER_SECOND).fill(0.2));
      vadMock.engines[0].emit({ type: "speech_start", timestampMs: 0 });
      // 224 ms of speech: not yet enough to stop the voice.
      emitFrames(0.95, 200);
    });

    hook.rerender({ speaking: false });
    await openSession();
    await waitFor(() => expect(hook.result.current.isDictating).toBe(true));

    expect(hook.onSpeechOverVoice).not.toHaveBeenCalled();
    expect(vadMock.engines[0].reset).not.toHaveBeenCalled();
    // The speech and half a second before it, not the whole wait; full
    // 100 ms chunks are sent, the rest waits for the next samples.
    const kept = sentSamples().reduce((sum, bytes) => sum + bytes / 2, 0);
    const keptOverVoice = ((224 + 500) * SAMPLES_PER_SECOND) / 1000;
    expect(kept).toBe(Math.floor(keptOverVoice / 1600) * 1600);
    const [wav] = MockWebSocket.instances[0].sentBinaryFrames;
    expect(wav.slice(44).some((byte) => byte !== 0)).toBe(true);
    // The detector's turn goes on and ends the turn as usual.
    act(() => {
      vadMock.engines[0].emit({
        type: "speech_end",
        timestampMs: 0,
        audio: new Float32Array(1),
      });
    });
    expect(hook.onVadAutoStop).toHaveBeenCalledTimes(1);
  });

  it("stops the voice at the default 500 ms when the configured minimum is malformed", async () => {
    const hook = renderOverVoice(true, Number.NaN);
    await startHeld(hook);
    act(() => {
      emitFrames(0.95, 448);
    });
    expect(hook.onSpeechOverVoice).not.toHaveBeenCalled();
    act(() => {
      emitFrames(0.95, 64);
    });
    expect(hook.onSpeechOverVoice).toHaveBeenCalledTimes(1);
  });

  it("returns to idle without a session or an error when stopped while it waits", async () => {
    const hook = renderOverVoice();
    await startHeld(hook);
    act(() => {
      emitFrames(0.95, 200);
    });

    await act(async () => {
      hook.result.current.toggleDictation();
    });

    await waitFor(() =>
      expect(hook.result.current.isDictationStarting).toBe(false),
    );
    expect(hook.result.current.dictationError).toBeNull();
    expect(hook.result.current.isListeningOverVoice).toBe(false);
    expect(hook.onVoiceLowered).toHaveBeenLastCalledWith(false);
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it("waits over the voice only when the recording started while it spoke", async () => {
    const hook = renderOverVoice(false);
    await act(async () => {
      hook.result.current.toggleDictation();
    });
    await openSession();
    await waitFor(() => expect(hook.result.current.isDictating).toBe(true));

    hook.rerender({ speaking: true });
    act(() => {
      emitFrames(0.95, 1000);
    });
    expect(hook.onSpeechOverVoice).not.toHaveBeenCalled();
    expect(hook.result.current.isListeningOverVoice).toBe(false);
  });
});

describe("resolveEndOfTurnSilenceMs", () => {
  it("keeps values the backend accepts and falls back to 1.8 s otherwise", () => {
    expect(resolveEndOfTurnSilenceMs(500)).toBe(500);
    expect(resolveEndOfTurnSilenceMs(5000)).toBe(5000);
    expect(resolveEndOfTurnSilenceMs(undefined)).toBe(1800);
    expect(resolveEndOfTurnSilenceMs(499)).toBe(1800);
    expect(resolveEndOfTurnSilenceMs(30_000)).toBe(1800);
    expect(resolveEndOfTurnSilenceMs(Number.NaN)).toBe(1800);
  });
});
