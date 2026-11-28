import { renderHook, act, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAudioInputDeviceStore } from "@/state/audioInputDeviceStore";
import {
  emitHostShellEvent,
  installHostShell,
  removeHostShell,
  shellAnswers,
} from "@/test/hostShellStub";
import { setPageVisibility } from "@/test/pageVisibility";

import { getAudioLevelBarsFromTimeDomainData } from "../audio-pcm-codec";
import {
  installAudioCaptureAccessPolicy,
  isAudioCaptureLive,
} from "../audioCaptureAccess";
import { MUTE_GRACE_MS } from "../audioTuning";
import { hesitationMatcher } from "../hesitations";
import { voiceHeardBy, voiceNoLongerHeardBy } from "../pcmPlayback";
import { closeShellVoiceAudio, openShellVoiceAudio } from "../shellVoiceAudio";
import {
  resolveEndOfTurnSilenceMs,
  useAudioDictationRecorder,
} from "../useAudioDictationRecorder";

vi.mock("../pcmPlayback", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../pcmPlayback")>()),
  voiceHeardBy: vi.fn(),
  voiceNoLongerHeardBy: vi.fn(),
}));

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
    configure: ReturnType<typeof vi.fn>;
    acceptFrame: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
    emit: (event: Parameters<Listener>[0]) => void;
  }[] = [];

  /** Set to make the detector's model load until it resolves. */
  const loading: { done: Promise<void> | null } = { done: null };

  const createRicky0123VadEngine = vi.fn((_options?: unknown) => {
    const engine = {
      listeners: [] as Listener[],
      acceptedFrames: [] as unknown[],
      start: vi.fn(async () => {
        await loading.done;
      }),
      stop: vi.fn(),
      destroy: vi.fn(),
      reset: vi.fn(),
      configure: vi.fn(),
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
    loading,
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

  constructor(private readonly echoCancellation = false) {
    super();
  }

  getSettings() {
    return {
      autoGainControl: false,
      channelCount: 1,
      echoCancellation: this.echoCancellation,
      noiseSuppression: false,
      sampleRate: 16000,
    };
  }
}

class MockMediaStream {
  private readonly track: MockMediaStreamTrack;

  constructor(echoCancellation = false) {
    this.track = new MockMediaStreamTrack(echoCancellation);
  }

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
    isHesitationOnly?: (words: string) => boolean;
    chatId?: string;
    onTurnLanguage?: (language: string) => void;
  },
) {
  return renderHook(() =>
    useAudioDictationRecorder({
      chatId: options?.chatId,
      onTurnLanguage: options?.onTurnLanguage,
      isHesitationOnly: options?.isHesitationOnly,
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

/** The detector is sure someone speaks: a conversational recording transcribes. */
function hearSpeech() {
  const engine = vadMock.engines.at(-1);
  engine?.emit({ type: "speech_start", timestampMs: 0 });
  engine?.emit({ type: "speech_real_start", timestampMs: 0 });
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

  it("clears starting state when the socket closes before session state, without trying again", async () => {
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
    // Classic dictation reports at once, as before.
    expect(MockWebSocket.instances).toHaveLength(1);
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
    // It listens before anything is sent.
    await waitFor(() => expect(result.current.isDictating).toBe(true));
    act(() => {
      emitAudioSamples(new Float32Array(1600).fill(0.1));
    });
    await waitFor(() =>
      expect(vadMock.engines[0].acceptFrame).toHaveBeenCalled(),
    );
    expect(MockWebSocket.instances).toHaveLength(0);

    act(() => hearSpeech());
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
    await waitFor(() =>
      expect(
        MockWebSocket.instances[0].sentBinaryFrames.length,
      ).toBeGreaterThan(0),
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
    await waitFor(() => expect(result.current.isDictating).toBe(true));
    act(() => {
      emitAudioSamples(new Float32Array(1600).fill(0.1));
      hearSpeech();
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
    await waitFor(() =>
      expect(
        MockWebSocket.instances[0].sentBinaryFrames.length,
      ).toBeGreaterThan(0),
    );

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
    await waitFor(() => expect(result.current.isDictating).toBe(true));
    act(() => hearSpeech());
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(2));
    expect(vadMock.engines).toHaveLength(1);
    expect(vadMock.engines[0].start).toHaveBeenCalledTimes(2);
    expect(vadMock.createRicky0123VadEngine).toHaveBeenCalledTimes(1);

    unmount();
    expect(vadMock.engines[0].destroy).toHaveBeenCalled();
  });

  it("ERMAIN-1326: names the chat at start and hands back the turn's spoken language", async () => {
    const onTurnLanguage = vi.fn();
    const { result } = renderDictationHook(vi.fn(), {
      mode: "conversational",
      vadAutoStopEnabled: true,
      chatId: "chat-1",
      onTurnLanguage,
    });

    await act(async () => {
      result.current.toggleDictation();
    });
    await waitFor(() => expect(vadMock.engines).toHaveLength(1));
    await waitFor(() => expect(result.current.isDictating).toBe(true));
    act(() => {
      emitAudioSamples(new Float32Array(1600).fill(0.1));
      hearSpeech();
    });
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    act(() => {
      MockWebSocket.instances[0].emit("open");
    });
    await waitFor(() =>
      expect(MockWebSocket.instances[0].sentJsonFrames).toContainEqual({
        mode: "conversational",
        type: "start",
        chat_id: "chat-1",
      }),
    );
    act(() => {
      MockWebSocket.instances[0].emitJson({
        type: "session_state",
        next_chunk_index: 0,
        chunk_duration_ms: 100,
      });
    });
    await waitFor(() =>
      expect(
        MockWebSocket.instances[0].sentBinaryFrames.length,
      ).toBeGreaterThan(0),
    );
    await act(async () => {
      result.current.toggleDictation();
    });
    act(() => {
      MockWebSocket.instances[0].emitJson({
        type: "completed",
        spoken_language: "de",
      });
    });
    await waitFor(() =>
      expect(result.current.isDictationCompleting).toBe(false),
    );
    expect(onTurnLanguage).toHaveBeenCalledExactlyOnceWith("de");
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

  it("hands a microphone opened over the voice to the voice's playback once it cancels echo", async () => {
    vi.mocked(voiceHeardBy).mockClear();
    vi.mocked(navigator.mediaDevices.getUserMedia).mockImplementation(
      async (constraints) =>
        new MockMediaStream(
          (constraints?.audio as MediaTrackConstraints | undefined)
            ?.echoCancellation === true,
        ) as unknown as MediaStream,
    );
    const hook = renderOverVoice();
    await startHeld(hook);

    expect(voiceHeardBy).toHaveBeenCalledTimes(1);
  });

  it("does not hand over a microphone whose echo the browser does not cancel", async () => {
    vi.mocked(voiceHeardBy).mockClear();
    const hook = renderOverVoice();
    await startHeld(hook);

    expect(voiceHeardBy).not.toHaveBeenCalled();
  });

  it("keeps today's session when the voice is quiet, with the echo cancelled for the voice to come", async () => {
    const hook = renderOverVoice(false);
    await act(async () => {
      hook.result.current.toggleDictation();
    });
    await waitFor(() => expect(hook.result.current.isDictating).toBe(true));
    act(() => hearSpeech());
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));

    expect(
      vi.mocked(navigator.mediaDevices.getUserMedia).mock.calls[0][0],
    ).toMatchObject({ audio: { echoCancellation: true } });
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

  it.each([
    ["", true],
    ["Äh.", true],
    ["Hm.", true],
    ["Okay.", true],
  ])(
    "ends a turn that paused the voice on silence, even with no words: %j (review 4)",
    async (transcript) => {
      const onVadAutoStop = vi.fn();
      const hook = renderHook(() =>
        useAudioDictationRecorder({
          enabled: true,
          mode: "conversational",
          maxRecordingDurationSeconds: 1200,
          onTranscriptChunk: vi.fn(),
          vadAutoStopEnabled: true,
          onVadAutoStop,
          voiceSpeaking: true,
          overVoiceMinSpeechMs: 300,
          onSpeechOverVoice: vi.fn(),
          onVoiceLowered: vi.fn(),
          isHesitationOnly: hesitationMatcher(undefined),
        }),
      );
      await act(async () => {
        hook.result.current.toggleDictation();
      });
      await waitFor(() =>
        expect(hook.result.current.isListeningOverVoice).toBe(true),
      );
      act(() => {
        emitAudioSamples(new Float32Array(SAMPLES_PER_SECOND).fill(0.2));
        vadMock.engines[0].emit({ type: "speech_start", timestampMs: 0 });
        vadMock.engines[0].emit({ type: "speech_real_start", timestampMs: 0 });
        emitFrames(0.95, 352);
      });
      await openSession();
      await waitFor(() => expect(hook.result.current.isDictating).toBe(true));
      act(() => {
        emitFrames(0.05, 320);
        vadMock.engines[0].emit({
          type: "speech_end",
          timestampMs: 0,
          audio: new Float32Array(1),
        });
      });
      await waitFor(() =>
        expect(
          MockWebSocket.instances[0].sentBinaryFrames.length,
        ).toBeGreaterThan(0),
      );
      // The turn's last piece is sent once the end of speech is checked.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
      });
      const sent = MockWebSocket.instances[0].sentBinaryFrames.length;
      for (let index = 0; index < sent; index += 1)
        act(() =>
          MockWebSocket.instances[0].emitJson({
            type: "chunk_transcribed",
            chunk_index: index,
            transcript: index === sent - 1 ? transcript : "",
          }),
        );
      await waitFor(() => expect(onVadAutoStop).toHaveBeenCalledTimes(1), {
        timeout: 4000,
      });
    },
    10000,
  );

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
    await waitFor(() => expect(hook.result.current.isDictating).toBe(true));
    // Nothing goes out until the user speaks.
    expect(MockWebSocket.instances).toHaveLength(0);
    act(() => hearSpeech());
    await openSession();

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
      // Enough for the turn's own minimum: it is the start of a turn.
      vadMock.engines[0].emit({ type: "speech_real_start", timestampMs: 0 });
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

  it("stops the voice at the default 300 ms when the configured minimum is malformed", async () => {
    const hook = renderOverVoice(true, Number.NaN);
    await startHeld(hook);
    act(() => {
      emitFrames(0.95, 256);
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
    await waitFor(() => expect(hook.result.current.isDictating).toBe(true));
    act(() => hearSpeech());
    await openSession();

    hook.rerender({ speaking: true });
    act(() => {
      emitFrames(0.95, 1000);
    });
    expect(hook.onSpeechOverVoice).not.toHaveBeenCalled();
    expect(hook.result.current.isListeningOverVoice).toBe(false);
  });
});

describe("useAudioDictationRecorder: a conversation keeps its microphone open", () => {
  const RATE = 16000;
  type Constraints = { audio: { echoCancellation?: boolean } };
  let getUserMedia: ReturnType<
    typeof vi.fn<(constraints: Constraints) => Promise<MockMediaStream>>
  >;

  beforeEach(() => {
    vi.restoreAllMocks();
    MockWebSocket.instances.length = 0;
    MockAudioWorkletNode.instances.length = 0;
    vadMock.engines.length = 0;
    vadMock.createRicky0123VadEngine.mockClear();
    getUserMedia = vi.fn(
      async (constraints: Constraints) =>
        new MockMediaStream(constraints.audio.echoCancellation === true),
    );
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    vi.stubGlobal("AudioContext", MockAudioContext);
    vi.stubGlobal("AudioWorkletNode", MockAudioWorkletNode);
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });

  const stoppedByHiddenPage = vi.fn();
  const render = (conversation = true, maxRecordingDurationSeconds = 1200) =>
    renderHook(
      ({ conversation }: { conversation: boolean }) =>
        useAudioDictationRecorder({
          enabled: true,
          mode: conversation ? "conversational" : "dictation",
          maxRecordingDurationSeconds,
          onTranscriptChunk: vi.fn(),
          vadAutoStopEnabled: conversation,
          onStoppedByHiddenPage: stoppedByHiddenPage,
        }),
      { initialProps: { conversation } },
    );

  const mute = (muted: MockMediaStreamTrack) => {
    muted.muted = true;
    muted.dispatchEvent(new Event("mute"));
  };

  const track = (index: number) =>
    (getUserMedia.mock.results[index].value as Promise<MockMediaStream>).then(
      (stream) => stream.getAudioTracks()[0],
    );

  async function listen(hook: ReturnType<typeof render>) {
    await act(async () => {
      hook.result.current.toggleDictation();
    });
    await waitFor(() => expect(hook.result.current.isDictating).toBe(true));
  }

  async function cancel(hook: ReturnType<typeof render>) {
    act(() => hook.result.current.cancelDictation());
    await waitFor(() => expect(hook.result.current.isDictating).toBe(false));
  }

  /** A whole turn: speech heard, sent, ended by the detector, transcribed. */
  async function speak(hook: ReturnType<typeof render>, socket: number) {
    await listen(hook);
    act(() => {
      emitAudioSamples(new Float32Array(RATE / 2).fill(0.2));
      hearSpeech();
    });
    await waitFor(() =>
      expect(MockWebSocket.instances).toHaveLength(socket + 1),
    );
    act(() => MockWebSocket.instances[socket].emit("open"));
    await waitFor(() =>
      expect(MockWebSocket.instances[socket].sentJsonFrames).toContainEqual(
        expect.objectContaining({ type: "start" }),
      ),
    );
    act(() =>
      MockWebSocket.instances[socket].emitJson({
        type: "session_state",
        next_chunk_index: 0,
        chunk_duration_ms: 30_000,
      }),
    );
    await act(async () => {});
    act(() =>
      vadMock.engines[0].emit({
        type: "speech_end",
        timestampMs: 0,
        audio: new Float32Array(1),
      }),
    );
    await waitFor(() =>
      expect(MockWebSocket.instances[socket].sentJsonFrames).toContainEqual({
        type: "finish",
      }),
    );
    act(() => MockWebSocket.instances[socket].emitJson({ type: "completed" }));
    await waitFor(() =>
      expect(hook.result.current.isDictationCompleting).toBe(false),
    );
  }

  it("opens the microphone once for all turns, with the echo cancelled", async () => {
    const hook = render();
    await speak(hook, 0);
    await listen(hook);
    await cancel(hook);
    await speak(hook, 1);
    await listen(hook);

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia.mock.calls[0]).toMatchObject([
      { audio: { echoCancellation: true } },
    ]);
    expect((await track(0)).stop).not.toHaveBeenCalled();
    // Each turn still hears through its own nodes and a fresh detector start.
    expect(MockAudioWorkletNode.instances).toHaveLength(4);
    expect(vadMock.engines[0].start).toHaveBeenCalledTimes(4);
  });

  it("closes the microphone when the conversation ends, and dictation opens its own each time", async () => {
    const hook = render();
    await listen(hook);
    await cancel(hook);
    const conversation = await track(0);
    expect(conversation.stop).not.toHaveBeenCalled();

    hook.rerender({ conversation: false });
    expect(conversation.stop).toHaveBeenCalled();

    await act(async () => {
      hook.result.current.toggleDictation();
    });
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    act(() => hook.result.current.cancelDictation());
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia.mock.calls[1]).toMatchObject([
      { audio: { echoCancellation: false } },
    ]);
    expect((await track(1)).stop).toHaveBeenCalled();
  });

  it("lets the voice play as conversation audio while the echo-cancelled microphone is open, not for a dictation started while the voice is quiet", async () => {
    vi.mocked(voiceHeardBy).mockClear();
    vi.mocked(voiceNoLongerHeardBy).mockClear();
    const hook = render();
    await listen(hook);
    await cancel(hook);
    const conversation = await getUserMedia.mock.results[0].value;
    expect(voiceHeardBy).toHaveBeenCalledTimes(1);
    expect(voiceHeardBy).toHaveBeenCalledWith(conversation);

    hook.rerender({ conversation: false });
    expect(voiceNoLongerHeardBy).toHaveBeenCalledWith(conversation);
    await act(async () => {
      hook.result.current.toggleDictation();
    });
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    act(() => hook.result.current.cancelDictation());

    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(voiceHeardBy).toHaveBeenCalledTimes(1);
  });

  it("closes the microphone when the page is hidden, and opens it again for the next turn", async () => {
    const hook = render();
    await listen(hook);
    await cancel(hook);

    act(() => setPageVisibility("hidden"));
    expect((await track(0)).stop).toHaveBeenCalled();

    act(() => setPageVisibility("visible"));
    await listen(hook);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it("closes the microphone a hidden page's running turn used, as that turn ends", async () => {
    const hook = render();
    await listen(hook);
    act(() => setPageVisibility("hidden"));
    expect((await track(0)).stop).not.toHaveBeenCalled();

    await cancel(hook);
    expect((await track(0)).stop).toHaveBeenCalled();
  });

  it.each([
    ["the page hides first", ["hide", "mute"]],
    ["the microphone mutes first", ["mute", "hide"]],
  ])(
    "a phone lock ends the turn at once without an error (%s)",
    async (_order, steps) => {
      stoppedByHiddenPage.mockClear();
      const hook = render();
      await listen(hook);
      const locked = await track(0);
      act(() => {
        for (const step of steps)
          if (step === "hide") setPageVisibility("hidden");
          else mute(locked);
      });

      await waitFor(() => expect(hook.result.current.isDictating).toBe(false));
      expect(hook.result.current.dictationError).toBeNull();
      expect(locked.stop).toHaveBeenCalled();
      expect(stoppedByHiddenPage).toHaveBeenCalledOnce();

      act(() => setPageVisibility("visible"));
      await listen(hook);
      expect(getUserMedia).toHaveBeenCalledTimes(2);
    },
  );

  it("a phone lock while dictating finishes the dictation without an error", async () => {
    const hook = render(false);
    await act(async () => {
      hook.result.current.toggleDictation();
    });
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0];
    act(() => socket.emit("open"));
    await waitFor(() =>
      expect(socket.sentJsonFrames).toContainEqual({
        mode: "dictation",
        type: "start",
      }),
    );
    act(() =>
      socket.emitJson({
        type: "session_state",
        next_chunk_index: 0,
        chunk_duration_ms: 30_000,
      }),
    );
    await waitFor(() => expect(hook.result.current.isDictating).toBe(true));

    act(() => {
      setPageVisibility("hidden");
      emitAudioSamples(new Float32Array(RATE / 2).fill(0.2));
    });
    await act(async () => mute(await track(0)));

    await waitFor(() =>
      expect(socket.sentJsonFrames).toContainEqual({ type: "finish" }),
    );
    act(() => socket.emitJson({ type: "completed" }));
    await waitFor(() =>
      expect(hook.result.current.isDictationCompleting).toBe(false),
    );
    expect(hook.result.current.dictationError).toBeNull();
  });

  it("a microphone that stops sending while the page is shown is still reported", async () => {
    const hook = render();
    await listen(hook);
    const dead = await track(0);
    vi.useFakeTimers();
    try {
      act(() => mute(dead));
      act(() => vi.advanceTimersByTime(MUTE_GRACE_MS));
    } finally {
      vi.useRealTimers();
    }
    await waitFor(() => expect(hook.result.current.isDictating).toBe(false));
    expect(hook.result.current.dictationError).toMatch(/stopped sending audio/);
  });

  it("drops a microphone that was lost and opens a new one for the next turn", async () => {
    const hook = render();
    await listen(hook);
    const lost = await track(0);
    act(() => {
      lost.readyState = "ended";
      lost.dispatchEvent(new Event("ended"));
    });
    await waitFor(() => expect(hook.result.current.isDictating).toBe(false));
    expect(hook.result.current.dictationError).toMatch(/disconnected/);

    await listen(hook);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it("closes the microphone on unmount", async () => {
    const hook = render();
    await listen(hook);
    await cancel(hook);
    hook.unmount();
    expect((await track(0)).stop).toHaveBeenCalled();
  });

  /** Ends the current turn while its connection still opens. */
  async function endWhileConnecting(hook: ReturnType<typeof render>) {
    act(() => {
      emitAudioSamples(new Float32Array(RATE / 2).fill(0.2));
      hearSpeech();
    });
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    await act(async () => {
      hook.result.current.toggleDictation();
    });
  }

  async function finishConnecting(hook: ReturnType<typeof render>) {
    act(() => MockWebSocket.instances[0].emit("open"));
    await waitFor(() =>
      expect(MockWebSocket.instances[0].sentJsonFrames).toContainEqual(
        expect.objectContaining({ type: "start" }),
      ),
    );
    act(() =>
      MockWebSocket.instances[0].emitJson({
        type: "session_state",
        next_chunk_index: 0,
        chunk_duration_ms: 30_000,
      }),
    );
    await waitFor(() =>
      expect(MockWebSocket.instances[0].sentJsonFrames).toContainEqual({
        type: "finish",
      }),
    );
    act(() => MockWebSocket.instances[0].emitJson({ type: "completed" }));
    await waitFor(() =>
      expect(hook.result.current.isDictationCompleting).toBe(false),
    );
  }

  it("closes the microphone when audio mode ends while a turn's connection opens", async () => {
    const hook = render();
    await listen(hook);
    await endWhileConnecting(hook);
    hook.rerender({ conversation: false });
    expect((await track(0)).stop).not.toHaveBeenCalled();

    await finishConnecting(hook);
    expect((await track(0)).stop).toHaveBeenCalled();
  });

  it("closes the microphone when the page is hidden while a turn's connection opens", async () => {
    const hook = render();
    await listen(hook);
    await endWhileConnecting(hook);
    act(() => setPageVisibility("hidden"));

    await finishConnecting(hook);
    expect((await track(0)).stop).toHaveBeenCalled();
  });

  describe("in a host that keeps audio going while the page is hidden", () => {
    beforeEach(() => {
      window.ERATO_SHELL = {
        contract: 1,
        capabilities: { audioWhileHidden: 1 },
        request: () => Promise.resolve(null),
        on: () => () => {},
      };
    });
    afterEach(() => {
      delete window.ERATO_SHELL;
      Reflect.deleteProperty(navigator, "audioSession");
    });

    it("keeps the microphone between turns while the page is hidden", async () => {
      const hook = render();
      await listen(hook);
      await cancel(hook);

      act(() => setPageVisibility("hidden"));
      expect((await track(0)).stop).not.toHaveBeenCalled();

      await listen(hook);
      expect(getUserMedia).toHaveBeenCalledOnce();
    });

    it("keeps the microphone a hidden page's turn used for the next turn", async () => {
      const hook = render();
      await listen(hook);
      act(() => setPageVisibility("hidden"));
      await cancel(hook);
      expect((await track(0)).stop).not.toHaveBeenCalled();

      await listen(hook);
      expect(getUserMedia).toHaveBeenCalledOnce();
    });

    it("still ends the turn without an error when the hidden page's microphone is muted after all", async () => {
      stoppedByHiddenPage.mockClear();
      const hook = render();
      await listen(hook);
      const muted = await track(0);
      act(() => {
        setPageVisibility("hidden");
        mute(muted);
      });

      await waitFor(() => expect(hook.result.current.isDictating).toBe(false));
      expect(hook.result.current.dictationError).toBeNull();
      expect(muted.stop).toHaveBeenCalled();
      expect(stoppedByHiddenPage).toHaveBeenCalledOnce();
    });

    it("says the page plays and records while the conversation runs", () => {
      const audioSession = { type: "auto" };
      Object.defineProperty(navigator, "audioSession", {
        configurable: true,
        value: audioSession,
      });
      const hook = render();
      expect(audioSession.type).toBe("play-and-record");

      hook.rerender({ conversation: false });
      expect(audioSession.type).toBe("auto");
    });

    it("leaves a session type that something else set meanwhile", () => {
      const audioSession = { type: "auto" };
      Object.defineProperty(navigator, "audioSession", {
        configurable: true,
        value: audioSession,
      });
      const hook = render();
      audioSession.type = "playback";

      hook.unmount();
      expect(audioSession.type).toBe("playback");
    });

    const pause = (ms: number) =>
      act(() => new Promise((resolve) => setTimeout(resolve, ms)));

    it("gives an idle microphone back on a hidden page after as long as a turn may listen", async () => {
      const hook = render(true, 0.2);
      await listen(hook);
      await cancel(hook);
      act(() => setPageVisibility("hidden"));
      await pause(100);
      expect((await track(0)).stop).not.toHaveBeenCalled();

      await pause(250);
      expect((await track(0)).stop).toHaveBeenCalled();
    });

    it("gives the microphone back on a hidden page when nobody spoke for the listening limit", async () => {
      const hook = render(true, 1);
      await listen(hook);
      act(() => setPageVisibility("hidden"));

      await waitFor(
        () => expect(hook.result.current.dictationError).not.toBeNull(),
        { timeout: 2000 },
      );
      expect((await track(0)).stop).toHaveBeenCalled();
    });

    it("keeps an idle microphone when the page is shown again in time", async () => {
      const hook = render(true, 0.2);
      await listen(hook);
      await cancel(hook);
      act(() => setPageVisibility("hidden"));
      act(() => setPageVisibility("visible"));

      await pause(350);
      expect((await track(0)).stop).not.toHaveBeenCalled();
    });

    it("waits the whole time again after each turn on a hidden page", async () => {
      const hook = render(true, 0.2);
      await listen(hook);
      act(() => setPageVisibility("hidden"));
      await pause(150);
      await cancel(hook);
      await pause(150);
      expect((await track(0)).stop).not.toHaveBeenCalled();

      await pause(200);
      expect((await track(0)).stop).toHaveBeenCalled();
    });

    it("closes the microphone when the conversation ends, hidden or not", async () => {
      const hook = render();
      await listen(hook);
      await cancel(hook);
      act(() => setPageVisibility("hidden"));

      hook.rerender({ conversation: false });
      expect((await track(0)).stop).toHaveBeenCalled();
    });
  });

  it("leaves the page's audio session alone without the host's capability", () => {
    const audioSession = { type: "auto" };
    Object.defineProperty(navigator, "audioSession", {
      configurable: true,
      value: audioSession,
    });
    try {
      render();
      expect(audioSession.type).toBe("auto");
    } finally {
      Reflect.deleteProperty(navigator, "audioSession");
    }
  });

  it("closes the microphone when a turn fails", async () => {
    const hook = render();
    await listen(hook);
    act(() => {
      emitAudioSamples(new Float32Array(RATE / 2).fill(0.2));
      hearSpeech();
    });
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    act(() => {
      MockWebSocket.instances[0].emitJson({ type: "error", code: "refused" });
      MockWebSocket.instances[0].close();
    });
    await waitFor(() =>
      expect(hook.result.current.dictationError).not.toBeNull(),
    );
    expect((await track(0)).stop).toHaveBeenCalled();

    await listen(hook);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it("opens the microphone anew when the open one does not cancel the echo", async () => {
    getUserMedia.mockImplementation(async () => new MockMediaStream(false));
    const hook = render();
    await listen(hook);
    await cancel(hook);
    expect((await track(0)).stop).toHaveBeenCalled();

    await listen(hook);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it("never stamps first speech later than it was said, however late the audio reaches the page", async () => {
    // The turn is asked for at 10 000 and the microphone captures from
    // 10 050. The page only sees that audio at 10 600, and the detector's
    // frames later still: what counts is when the words were captured.
    const now = vi.spyOn(Date, "now").mockReturnValue(10_000);
    const hook = render();
    await listen(hook);
    const capturedFrom = 10_050;

    now.mockReturnValue(10_600);
    act(() => emitAudioSamples(new Float32Array(RATE / 10)));
    now.mockReturnValue(10_900);
    // The detector hears the 300 ms of silence first, then the microphone's
    // audio; speech starts in the microphone's fourth frame.
    const silenceFrames = 300 / 32;
    act(() => {
      for (let frame = 0; frame < 14; frame += 1)
        vadMock.engines[0].emit({
          type: "frame",
          frame: { samples: new Float32Array(512), sampleRate: RATE },
          probabilities: { isSpeech: frame < 13 ? 0 : 0.9, notSpeech: 0.1 },
        });
    });
    const saidAt = capturedFrom + (13 - silenceFrames) * 32;

    const signals = hook.result.current.readRecordingSignals();
    expect(signals?.startedAt).toBe(10_000);
    expect(signals?.firstSpeechAt).not.toBeNull();
    expect(signals?.firstSpeechAt ?? Infinity).toBeLessThanOrEqual(saidAt);
    now.mockRestore();
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

describe("useAudioDictationRecorder: a conversational turn transcribes only speech", () => {
  const RATE = 16000;

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

  const render = (onTranscriptChunk = vi.fn()) =>
    renderDictationHook(onTranscriptChunk, {
      mode: "conversational",
      vadAutoStopEnabled: true,
    });

  const endOfSpeech = () =>
    act(() => {
      vadMock.engines[0].emit({
        type: "speech_end",
        timestampMs: 0,
        audio: new Float32Array(1),
      });
    });

  async function listen(
    hook: ReturnType<typeof render>,
    turn?: Parameters<
      ReturnType<typeof useAudioDictationRecorder>["toggleDictation"]
    >[0],
  ) {
    await act(async () => {
      hook.result.current.toggleDictation(turn);
    });
    await waitFor(() => expect(hook.result.current.isDictating).toBe(true));
  }

  async function openSession(index = 0, chunkDurationMs = 30_000) {
    await waitFor(
      () => expect(MockWebSocket.instances).toHaveLength(index + 1),
      { timeout: 2500 },
    );
    act(() => {
      MockWebSocket.instances[index].emit("open");
    });
    await waitFor(() =>
      expect(MockWebSocket.instances[index].sentJsonFrames).toContainEqual(
        expect.objectContaining({ type: "start" }),
      ),
    );
    act(() => {
      MockWebSocket.instances[index].emitJson({
        type: "session_state",
        next_chunk_index: 0,
        chunk_duration_ms: chunkDurationMs,
      });
    });
    // The session is published once the handshake's awaits have run.
    await act(async () => {});
  }

  const frames = (probability: number, ms: number) => {
    for (let at = 0; at < ms; at += 32) {
      vadMock.engines[0].emit({
        type: "frame",
        frame: { samples: new Float32Array(512), sampleRate: RATE },
        probabilities: { isSpeech: probability, notSpeech: 1 - probability },
      });
    }
  };

  /** Every sample sent so far, as 16-bit values, without the WAV header. */
  const sentPcm = (index = 0) =>
    MockWebSocket.instances[index].sentBinaryFrames.flatMap((frame, at) => {
      const bytes = at === 0 ? frame.slice(44) : frame;
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
      return Array.from({ length: bytes.length / 2 }, (_, i) =>
        view.getInt16(i * 2, true),
      );
    });

  it("opens no connection and uploads nothing while nobody speaks", async () => {
    const hook = render();
    await listen(hook);
    act(() => {
      for (let second = 0; second < 40; second += 1)
        emitAudioSamples(new Float32Array(RATE).fill(0.001));
    });
    expect(MockWebSocket.instances).toHaveLength(0);

    // Closing it before anyone spoke costs nothing and shows no error.
    await act(async () => {
      hook.result.current.toggleDictation();
    });
    await waitFor(() => expect(hook.result.current.isDictating).toBe(false));
    expect(hook.result.current.dictationError).toBeNull();
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it("drops a sound the detector rejected instead of carrying it into the next turn", async () => {
    const hook = render();
    await listen(hook);
    act(() => {
      // "Halt", too short for the turn's minimum: a misfire after the silence.
      vadMock.engines[0].emit({ type: "speech_start", timestampMs: 0 });
      emitAudioSamples(new Float32Array(RATE / 2).fill(0.5));
      emitAudioSamples(new Float32Array(RATE).fill(0));
      vadMock.engines[0].emit({ type: "vad_misfire", timestampMs: 0 });
      // "Okay", heard.
      emitAudioSamples(new Float32Array(RATE / 2).fill(0.25));
      hearSpeech();
    });
    await openSession();
    act(() => {
      vadMock.engines[0].emit({
        type: "speech_end",
        timestampMs: 0,
        audio: new Float32Array(1),
      });
    });
    await waitFor(() =>
      expect(MockWebSocket.instances[0].sentJsonFrames).toContainEqual({
        type: "finish",
      }),
    );

    const sent = sentPcm();
    const halt = Math.round(0.5 * 32768);
    const okay = Math.round(0.25 * 32768);
    expect(sent.some((value) => Math.abs(value - halt) < 2)).toBe(false);
    expect(sent.filter((value) => Math.abs(value - okay) < 2)).toHaveLength(
      RATE / 2,
    );
  });

  it("keeps what was said while the connection opens, and finishes the turn once it is open", async () => {
    const onTranscriptChunk = vi.fn();
    const hook = render(onTranscriptChunk);
    await listen(hook);
    act(() => {
      emitAudioSamples(new Float32Array(RATE / 4).fill(0.25));
      hearSpeech();
      vadMock.engines[0].emit({
        type: "speech_end",
        timestampMs: 0,
        audio: new Float32Array(1),
      });
    });
    await waitFor(() =>
      expect(hook.result.current.isDictationCompleting).toBe(true),
    );

    await openSession();
    await waitFor(() =>
      expect(MockWebSocket.instances[0].sentJsonFrames).toContainEqual({
        type: "finish",
      }),
    );
    expect(sentPcm().filter((value) => value > 8000)).toHaveLength(RATE / 4);
    act(() => {
      MockWebSocket.instances[0].emitJson({
        type: "chunk_transcribed",
        chunk_index: 0,
        transcript: "weiter",
      });
      MockWebSocket.instances[0].emitJson({ type: "completed" });
    });
    await waitFor(() => expect(hook.result.current.isDictating).toBe(false));
    expect(onTranscriptChunk).toHaveBeenCalledWith({
      chunkIndex: 0,
      transcript: "weiter",
    });
    expect(hook.result.current.dictationError).toBeNull();
  });

  it("cuts a long turn in a pause, never inside speech, and only audio the detector has judged", async () => {
    const hook = render();
    await listen(hook);
    act(() => hearSpeech());
    await openSession();
    act(() => {
      // Audio first, the detector's verdicts on it a moment later.
      for (let second = 0; second < 21; second += 1) {
        emitAudioSamples(new Float32Array(RATE).fill(0.2));
        frames(0.9, 992);
      }
    });
    // 21 s of speech and no pause yet: nothing is cut.
    await act(async () => {});
    expect(MockWebSocket.instances[0].sentBinaryFrames).toHaveLength(0);

    act(() => {
      // A short pause, and the next word already captured…
      emitAudioSamples(new Float32Array(RATE / 10).fill(0));
      emitAudioSamples(new Float32Array(4096).fill(0.5));
      // …when the detector says the pause was silent.
      frames(0.05, 96);
    });
    await waitFor(() =>
      expect(MockWebSocket.instances[0].sentBinaryFrames).toHaveLength(1),
    );
    const word = Math.round(0.5 * 32768);
    expect(sentPcm().some((value) => Math.abs(value - word) < 2)).toBe(false);
    expect(sentPcm().length).toBeGreaterThan(20 * RATE);

    // The word goes out with the rest of the turn.
    act(() => {
      vadMock.engines[0].emit({
        type: "speech_end",
        timestampMs: 0,
        audio: new Float32Array(1),
      });
    });
    await waitFor(() =>
      expect(MockWebSocket.instances[0].sentJsonFrames).toContainEqual({
        type: "finish",
      }),
    );
    expect(
      sentPcm().filter((value) => Math.abs(value - word) < 2),
    ).toHaveLength(4096);
  });

  it("cuts a speaker who never pauses at the server's piece length, and goes on from there", async () => {
    const hook = render();
    await listen(hook);
    act(() => hearSpeech());
    await openSession();
    act(() => {
      frames(0.9, 64);
      for (let second = 0; second < 31; second += 1)
        emitAudioSamples(new Float32Array(RATE).fill(0.2));
    });
    await waitFor(() =>
      expect(MockWebSocket.instances[0].sentBinaryFrames).toHaveLength(1),
    );
    const metadata = MockWebSocket.instances[0].sentJsonFrames.filter(
      (frame) => frame.type === "chunk_metadata",
    );
    expect(metadata).toEqual([
      expect.objectContaining({ chunk_index: 0, start_ms: 0, end_ms: 30_000 }),
    ]);
  });

  it("transcribes nothing of a recording that is cancelled after speech", async () => {
    const onTranscriptChunk = vi.fn();
    const hook = render(onTranscriptChunk);
    await listen(hook);
    act(() => {
      emitAudioSamples(new Float32Array(RATE).fill(0.2));
      hearSpeech();
    });
    await openSession();
    await act(async () => {});

    act(() => hook.result.current.cancelDictation());
    await waitFor(() => expect(hook.result.current.isDictating).toBe(false));
    expect(MockWebSocket.instances[0].close).toHaveBeenCalled();
    expect(MockWebSocket.instances[0].sentJsonFrames).not.toContainEqual({
      type: "finish",
    });
    act(() => {
      MockWebSocket.instances[0].emitJson({
        type: "chunk_transcribed",
        chunk_index: 0,
        transcript: "thought",
      });
      MockWebSocket.instances[0].emit("error");
    });
    expect(onTranscriptChunk).not.toHaveBeenCalled();
    expect(hook.result.current.dictationError).toBeNull();
  });

  it("listens to a card with the card's own silence and minimum speech", async () => {
    const hook = render();
    await listen(hook, { endOfTurnSilenceMs: 1000, minSpeechMs: 64 });
    expect(vadMock.createRicky0123VadEngine).toHaveBeenCalledWith(
      expect.objectContaining({ redemptionMs: 1000, minSpeechMs: 64 }),
    );
    await act(async () => {
      hook.result.current.toggleDictation();
    });
    await waitFor(() => expect(hook.result.current.isDictating).toBe(false));

    // The next conversational turn goes back to the conversation's own.
    await listen(hook);
    expect(vadMock.engines[0].configure).toHaveBeenLastCalledWith({
      redemptionMs: 1800,
      minSpeechMs: 250,
    });
  });

  it("takes the deployment's minimum speech for a conversation, and a malformed one falls back", async () => {
    const hook = renderHook(
      ({ minSpeechMs }: { minSpeechMs: number }) =>
        useAudioDictationRecorder({
          enabled: true,
          mode: "conversational",
          maxRecordingDurationSeconds: 1200,
          onTranscriptChunk: vi.fn(),
          vadAutoStopEnabled: true,
          minSpeechMs,
        }),
      { initialProps: { minSpeechMs: 320 } },
    );
    await act(async () => {
      hook.result.current.toggleDictation();
    });
    await waitFor(() => expect(hook.result.current.isDictating).toBe(true));
    expect(vadMock.engines[0].configure).toHaveBeenLastCalledWith(
      expect.objectContaining({ minSpeechMs: 320 }),
    );
    await act(async () => {
      hook.result.current.toggleDictation();
    });
    await waitFor(() => expect(hook.result.current.isDictating).toBe(false));

    hook.rerender({ minSpeechMs: 5 });
    await act(async () => {
      hook.result.current.toggleDictation();
    });
    await waitFor(() => expect(hook.result.current.isDictating).toBe(true));
    expect(vadMock.engines[0].configure).toHaveBeenLastCalledWith(
      expect.objectContaining({ minSpeechMs: 250 }),
    );
  });

  it("B2: keeps everything said while the detector loads, and lets it hear that first", async () => {
    let loaded!: () => void;
    vadMock.loading.done = new Promise((resolve) => {
      loaded = resolve;
    });
    const hook = render();
    await act(async () => {
      hook.result.current.toggleDictation();
    });
    // Two seconds said while the model loads.
    act(() => {
      for (let tenth = 0; tenth < 20; tenth += 1)
        emitAudioSamples(new Float32Array(RATE / 10).fill(0.25));
    });
    expect(MockWebSocket.instances).toHaveLength(0);
    await act(async () => {
      loaded();
      await vadMock.loading.done;
    });
    vadMock.loading.done = null;
    await waitFor(() => expect(hook.result.current.isDictating).toBe(true));
    // The detector heard the whole backlog before any live frame.
    const backlog = vadMock.engines[0].acceptedFrames[0] as {
      samples: Float32Array;
    };
    expect(
      Array.from(backlog.samples).filter((value) => value > 0.2),
    ).toHaveLength(2 * RATE);

    act(() => {
      hearSpeech();
      emitAudioSamples(new Float32Array(RATE / 2).fill(0.3));
    });
    await openSession();
    endOfSpeech();
    await waitFor(() =>
      expect(MockWebSocket.instances[0].sentJsonFrames).toContainEqual({
        type: "finish",
      }),
    );
    const said = Math.round(0.25 * 32768);
    expect(
      sentPcm().filter((value) => Math.abs(value - said) < 2),
    ).toHaveLength(2 * RATE);
  });

  it("B2: a turn the detector heard end while it caught up still ends once it runs", async () => {
    let loaded!: () => void;
    vadMock.loading.done = new Promise((resolve) => {
      loaded = resolve;
    });
    const onVadAutoStop = vi.fn();
    const hook = renderDictationHook(vi.fn(), {
      mode: "conversational",
      vadAutoStopEnabled: true,
      onVadAutoStop,
    });
    await act(async () => {
      hook.result.current.toggleDictation();
    });
    act(() => emitAudioSamples(new Float32Array(RATE).fill(0.25)));
    await waitFor(() => expect(vadMock.engines).toHaveLength(1));
    // Its verdicts on the backlog: a whole turn.
    // The mock's own type says void; the engine's acceptFrame is async.
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    vadMock.engines[0].acceptFrame.mockImplementationOnce(() => {
      hearSpeech();
      vadMock.engines[0].emit({
        type: "speech_end",
        timestampMs: 0,
        audio: new Float32Array(1),
      });
      return Promise.resolve();
    });
    await act(async () => {
      loaded();
      await vadMock.loading.done;
    });
    vadMock.loading.done = null;
    await waitFor(() => expect(onVadAutoStop).toHaveBeenCalledTimes(1));
    await openSession();
    await waitFor(() =>
      expect(MockWebSocket.instances[0].sentJsonFrames).toContainEqual({
        type: "finish",
      }),
    );
    expect(sentPcm().filter((value) => value > 8000)).toHaveLength(RATE);
  });

  it("N3: a sound rejected while the detector catches up does not cut the speech after it", async () => {
    let loaded!: () => void;
    vadMock.loading.done = new Promise((resolve) => {
      loaded = resolve;
    });
    const hook = render();
    await act(async () => {
      hook.result.current.toggleDictation();
    });
    // A cough, its silence, then two seconds of a question, all in the load.
    act(() => {
      emitAudioSamples(new Float32Array(RATE / 4).fill(0.6));
      emitAudioSamples(new Float32Array(RATE * 2).fill(0));
      emitAudioSamples(new Float32Array(RATE * 2).fill(0.25));
    });
    await waitFor(() => expect(vadMock.engines).toHaveLength(1));
    // eslint-disable-next-line @typescript-eslint/no-misused-promises -- the mock's own type says void
    vadMock.engines[0].acceptFrame.mockImplementationOnce(() => {
      vadMock.engines[0].emit({ type: "speech_start", timestampMs: 0 });
      vadMock.engines[0].emit({ type: "vad_misfire", timestampMs: 0 });
      hearSpeech();
      return Promise.resolve();
    });
    await act(async () => {
      loaded();
      await vadMock.loading.done;
    });
    vadMock.loading.done = null;
    await openSession();
    endOfSpeech();
    await waitFor(() =>
      expect(MockWebSocket.instances[0].sentJsonFrames).toContainEqual({
        type: "finish",
      }),
    );
    const question = Math.round(0.25 * 32768);
    expect(
      sentPcm().filter((value) => Math.abs(value - question) < 2),
    ).toHaveLength(2 * RATE);
  });

  it("F2: after a rejected sound with a short silence, none of the sound is kept", async () => {
    const hook = render();
    await listen(hook, { endOfTurnSilenceMs: 500 });
    act(() => {
      vadMock.engines[0].emit({ type: "speech_start", timestampMs: 0 });
      emitAudioSamples(new Float32Array((RATE * 3) / 10).fill(0.5));
      emitAudioSamples(new Float32Array(RATE / 2).fill(0));
      vadMock.engines[0].emit({ type: "vad_misfire", timestampMs: 0 });
      emitAudioSamples(new Float32Array(RATE / 4).fill(0.25));
      hearSpeech();
    });
    await openSession();
    endOfSpeech();
    await waitFor(() =>
      expect(MockWebSocket.instances[0].sentJsonFrames).toContainEqual({
        type: "finish",
      }),
    );
    const rejected = Math.round(0.5 * 32768);
    expect(sentPcm().some((value) => Math.abs(value - rejected) < 2)).toBe(
      false,
    );
  });

  it("B3: a refusal while connecting is not tried again", async () => {
    const hook = render();
    await listen(hook);
    act(() => hearSpeech());
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    act(() => MockWebSocket.instances[0].emit("open"));
    await waitFor(() =>
      expect(MockWebSocket.instances[0].sentJsonFrames).toContainEqual(
        expect.objectContaining({ type: "start" }),
      ),
    );
    act(() =>
      MockWebSocket.instances[0].emitJson({
        type: "error",
        error: "Audio conversational is not enabled",
      }),
    );
    await waitFor(() =>
      expect(hook.result.current.dictationError).toBe(
        "Audio conversational is not enabled",
      ),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
    });
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  describe("B1: hesitation sounds end no turn", () => {
    const hesitant = (onTranscriptChunk = vi.fn(), onVadAutoStop = vi.fn()) =>
      renderDictationHook(onTranscriptChunk, {
        mode: "conversational",
        vadAutoStopEnabled: true,
        onVadAutoStop,
        isHesitationOnly: hesitationMatcher(undefined),
      });

    /** Audio said, and the detector's verdicts on it. */
    const said = (samples: Float32Array) => {
      emitAudioSamples(samples);
      frames(0.9, (samples.length / RATE) * 1000);
    };

    const transcribed = (index: number, transcript: string) =>
      act(() =>
        MockWebSocket.instances[0].emitJson({
          type: "chunk_transcribed",
          chunk_index: index,
          transcript,
        }),
      );

    it("'Äh', a pause, then a question: the question arrives whole, the 'Äh' not at all", async () => {
      const onTranscriptChunk = vi.fn();
      const onVadAutoStop = vi.fn();
      const hook = hesitant(onTranscriptChunk, onVadAutoStop);
      await listen(hook);
      // The detector's verdicts on the silence primer.
      frames(0.05, 320);
      act(() => {
        said(new Float32Array(RATE / 4).fill(0.1));
        hearSpeech();
      });
      await openSession();
      // The pause after "Äh" seems to end the turn: its words are checked.
      endOfSpeech();
      await waitFor(() =>
        expect(MockWebSocket.instances[0].sentBinaryFrames).toHaveLength(1),
      );
      expect(onVadAutoStop).not.toHaveBeenCalled();
      // The question starts before the words of "Äh" are back.
      act(() => {
        said(new Float32Array(RATE / 10).fill(0.4));
        hearSpeech();
        said(new Float32Array(RATE).fill(0.4));
      });
      transcribed(0, "Äh.");
      expect(hook.result.current.isDictating).toBe(true);
      expect(onVadAutoStop).not.toHaveBeenCalled();
      endOfSpeech();
      await waitFor(() =>
        expect(MockWebSocket.instances[0].sentBinaryFrames).toHaveLength(2),
      );
      transcribed(1, "Wie spät ist es?");
      await waitFor(() => expect(onVadAutoStop).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(MockWebSocket.instances[0].sentJsonFrames).toContainEqual({
          type: "finish",
        }),
      );
      // All of the question was sent.
      const question = Math.round(0.4 * 32768);
      expect(
        sentPcm().filter((value) => Math.abs(value - question) < 2),
      ).toHaveLength(RATE + RATE / 10);
      act(() => MockWebSocket.instances[0].emitJson({ type: "completed" }));
      await waitFor(() => expect(hook.result.current.isDictating).toBe(false));
      expect(onTranscriptChunk.mock.calls.map(([chunk]) => chunk)).toEqual([
        { chunkIndex: 0, transcript: "" },
        { chunkIndex: 1, transcript: "Wie spät ist es?" },
      ]);
    });

    it("a lone 'Ja' is a turn, and nothing listens on after it", async () => {
      const onTranscriptChunk = vi.fn();
      const onVadAutoStop = vi.fn();
      const hook = hesitant(onTranscriptChunk, onVadAutoStop);
      await listen(hook);
      // The detector's verdicts on the silence primer.
      frames(0.05, 320);
      act(() => {
        said(new Float32Array(RATE / 4).fill(0.3));
        hearSpeech();
      });
      await openSession();
      endOfSpeech();
      await waitFor(() =>
        expect(MockWebSocket.instances[0].sentBinaryFrames).toHaveLength(1),
      );
      transcribed(0, "Ja.");
      await waitFor(() => expect(onVadAutoStop).toHaveBeenCalledTimes(1));
      act(() => MockWebSocket.instances[0].emitJson({ type: "completed" }));
      await waitFor(() => expect(hook.result.current.isDictating).toBe(false));
      expect(onTranscriptChunk).toHaveBeenCalledWith({
        chunkIndex: 0,
        transcript: "Ja.",
      });
    });

    it("silence after 'um' with nothing more: it keeps listening and sends nothing more", async () => {
      const onVadAutoStop = vi.fn();
      const hook = hesitant(vi.fn(), onVadAutoStop);
      await listen(hook);
      // The detector's verdicts on the silence primer.
      frames(0.05, 320);
      act(() => hearSpeech());
      await openSession();
      endOfSpeech();
      await waitFor(() =>
        expect(MockWebSocket.instances[0].sentBinaryFrames).toHaveLength(1),
      );
      transcribed(0, "um");
      act(() => {
        for (let second = 0; second < 5; second += 1)
          emitAudioSamples(new Float32Array(RATE).fill(0.001));
      });
      await act(async () => {});
      expect(MockWebSocket.instances[0].sentBinaryFrames).toHaveLength(1);
      expect(hook.result.current.isDictating).toBe(true);
      expect(onVadAutoStop).not.toHaveBeenCalled();
    });

    it.each(["Äh, 42.", "Ähm, 3.", "Um, 10.", "Ähm, 15:30."])(
      "N1: a number after a hesitation is an answer: %s",
      async (answer) => {
        const onTranscriptChunk = vi.fn();
        const onVadAutoStop = vi.fn();
        const hook = hesitant(onTranscriptChunk, onVadAutoStop);
        await listen(hook);
        frames(0.05, 320);
        act(() => {
          said(new Float32Array(RATE / 4).fill(0.3));
          hearSpeech();
        });
        await openSession();
        endOfSpeech();
        await waitFor(() =>
          expect(MockWebSocket.instances[0].sentBinaryFrames).toHaveLength(1),
        );
        transcribed(0, answer);
        await waitFor(() => expect(onVadAutoStop).toHaveBeenCalledTimes(1));
        act(() => MockWebSocket.instances[0].emitJson({ type: "completed" }));
        await waitFor(() =>
          expect(hook.result.current.isDictating).toBe(false),
        );
        expect(onTranscriptChunk).toHaveBeenCalledWith({
          chunkIndex: 0,
          transcript: answer,
        });
      },
    );

    it("N1: a number said after an earlier held 'Äh' is sent, the 'Äh' alone blanked", async () => {
      const onTranscriptChunk = vi.fn();
      const onVadAutoStop = vi.fn();
      const hook = hesitant(onTranscriptChunk, onVadAutoStop);
      await listen(hook);
      frames(0.05, 320);
      act(() => {
        said(new Float32Array(RATE / 4).fill(0.1));
        hearSpeech();
      });
      await openSession();
      endOfSpeech();
      await waitFor(() =>
        expect(MockWebSocket.instances[0].sentBinaryFrames).toHaveLength(1),
      );
      transcribed(0, "Äh.");
      await waitFor(() =>
        expect(hook.result.current.heldHesitation).toBe("Äh."),
      );
      act(() => {
        said(new Float32Array(RATE / 2).fill(0.4));
        hearSpeech();
      });
      expect(hook.result.current.heldHesitation).toBeNull();
      endOfSpeech();
      await waitFor(() =>
        expect(MockWebSocket.instances[0].sentBinaryFrames).toHaveLength(2),
      );
      transcribed(1, "42.");
      await waitFor(() => expect(onVadAutoStop).toHaveBeenCalledTimes(1));
      act(() => MockWebSocket.instances[0].emitJson({ type: "completed" }));
      await waitFor(() => expect(hook.result.current.isDictating).toBe(false));
      expect(onTranscriptChunk.mock.calls.map(([chunk]) => chunk)).toEqual([
        { chunkIndex: 0, transcript: "" },
        { chunkIndex: 1, transcript: "42." },
      ]);
    });

    it("S1: a turn ends with its checked words only; the room sound during the check is not sent", async () => {
      const onTranscriptChunk = vi.fn();
      const onVadAutoStop = vi.fn();
      const hook = hesitant(onTranscriptChunk, onVadAutoStop);
      await listen(hook);
      frames(0.05, 320);
      act(() => {
        said(new Float32Array(RATE).fill(0.4));
        hearSpeech();
      });
      await openSession();
      // The pause that ends it, judged as silence.
      act(() => {
        emitAudioSamples(new Float32Array((RATE * 18) / 10).fill(0));
        frames(0.05, 1800);
      });
      endOfSpeech();
      await waitFor(() =>
        expect(MockWebSocket.instances[0].sentBinaryFrames).toHaveLength(1),
      );
      // 1.5 s of quiet room sound while the words come back.
      act(() => {
        emitAudioSamples(new Float32Array((RATE * 15) / 10).fill(0.002));
        frames(0.05, 1500);
      });
      transcribed(0, "Wie spät ist es?");
      await waitFor(() => expect(onVadAutoStop).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(MockWebSocket.instances[0].sentJsonFrames).toContainEqual({
          type: "finish",
        }),
      );
      // One piece only: nothing after the turn's words.
      expect(MockWebSocket.instances[0].sentBinaryFrames).toHaveLength(1);
      act(() => MockWebSocket.instances[0].emitJson({ type: "completed" }));
      await waitFor(() => expect(hook.result.current.isDictating).toBe(false));
      expect(onTranscriptChunk.mock.calls.map(([chunk]) => chunk)).toEqual([
        { chunkIndex: 0, transcript: "Wie spät ist es?" },
      ]);
    });

    it("N4: the newest audio, not yet judged, is not taken into the checked piece", async () => {
      const hook = hesitant();
      await listen(hook);
      // Verdicts on exactly what they cover: 9 and 8 frames of 512 samples.
      frames(0.05, 288);
      act(() => {
        emitAudioSamples(new Float32Array(4096).fill(0.1));
        frames(0.9, 256);
        hearSpeech();
      });
      await openSession();
      // Speech resumes right at the end of the pause: not judged yet.
      act(() => emitAudioSamples(new Float32Array(2048).fill(0.5)));
      endOfSpeech();
      await waitFor(() =>
        expect(MockWebSocket.instances[0].sentBinaryFrames).toHaveLength(1),
      );
      const resumed = Math.round(0.5 * 32768);
      expect(sentPcm().some((value) => Math.abs(value - resumed) < 2)).toBe(
        false,
      );
      transcribed(0, "Äh.");
      act(() => {
        hearSpeech();
        said(new Float32Array(RATE / 2).fill(0.4));
      });
      endOfSpeech();
      await waitFor(() =>
        expect(MockWebSocket.instances[0].sentBinaryFrames).toHaveLength(2),
      );
      expect(
        sentPcm().filter((value) => Math.abs(value - resumed) < 2),
      ).toHaveLength(2048);
    });

    it("N2: a lone 'Äh' said while the detector loads is checked like any other", async () => {
      let loaded!: () => void;
      vadMock.loading.done = new Promise((resolve) => {
        loaded = resolve;
      });
      const onVadAutoStop = vi.fn();
      const hook = hesitant(vi.fn(), onVadAutoStop);
      await act(async () => {
        hook.result.current.toggleDictation();
      });
      act(() => emitAudioSamples(new Float32Array(RATE / 4).fill(0.1)));
      await waitFor(() => expect(vadMock.engines).toHaveLength(1));
      // eslint-disable-next-line @typescript-eslint/no-misused-promises -- the mock's own type says void
      vadMock.engines[0].acceptFrame.mockImplementationOnce(() => {
        frames(0.9, 600);
        hearSpeech();
        vadMock.engines[0].emit({
          type: "speech_end",
          timestampMs: 0,
          audio: new Float32Array(1),
        });
        return Promise.resolve();
      });
      await act(async () => {
        loaded();
        await vadMock.loading.done;
      });
      vadMock.loading.done = null;
      await openSession();
      await waitFor(() =>
        expect(MockWebSocket.instances[0].sentBinaryFrames).toHaveLength(1),
      );
      transcribed(0, "Äh.");
      await act(async () => {});
      expect(onVadAutoStop).not.toHaveBeenCalled();
      expect(MockWebSocket.instances[0].sentJsonFrames).not.toContainEqual({
        type: "finish",
      });
      expect(hook.result.current.isDictating).toBe(true);
    });

    it("a card's turn ends on 'äh' at once: its own rules answer it", async () => {
      const onVadAutoStop = vi.fn();
      const hook = hesitant(vi.fn(), onVadAutoStop);
      await listen(hook, { keepHesitations: true, minSpeechMs: 64 });
      act(() => hearSpeech());
      await openSession();
      endOfSpeech();
      expect(onVadAutoStop).toHaveBeenCalledTimes(1);
    });
  });

  it("tries the connection once more after a failure, the words kept, without an error", async () => {
    const hook = render();
    await listen(hook);
    act(() => {
      emitAudioSamples(new Float32Array(RATE / 4).fill(0.25));
      hearSpeech();
    });
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    act(() => {
      MockWebSocket.instances[0].emit("error");
    });
    await openSession(1);
    act(() => {
      vadMock.engines[0].emit({
        type: "speech_end",
        timestampMs: 0,
        audio: new Float32Array(1),
      });
    });
    await waitFor(() =>
      expect(MockWebSocket.instances[1].sentJsonFrames).toContainEqual({
        type: "finish",
      }),
    );
    expect(sentPcm(1).filter((value) => value > 8000)).toHaveLength(RATE / 4);
    expect(hook.result.current.dictationError).toBeNull();
  });
});

describe("useAudioDictationRecorder: connections of earlier recordings", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    MockWebSocket.instances.length = 0;
    MockAudioWorkletNode.instances.length = 0;
    vi.stubGlobal("AudioContext", MockAudioContext);
    vi.stubGlobal("AudioWorkletNode", MockAudioWorkletNode);
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });

  it("opens no connection for a recording cancelled while the microphone starts", async () => {
    const stream = createDeferred<MockMediaStream>();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(() => stream.promise) },
    });
    const { result } = renderDictationHook();
    await act(async () => {
      result.current.toggleDictation();
    });
    act(() => result.current.cancelDictation());
    await act(async () => {
      stream.resolve(new MockMediaStream());
      await stream.promise;
    });
    await waitFor(() => expect(result.current.isDictationStarting).toBe(false));
    expect(MockWebSocket.instances).toHaveLength(0);
    expect(result.current.dictationError).toBeNull();
  });

  it("does not report an earlier recording's connection error as the current one's", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => new MockMediaStream()) },
    });
    const { result } = renderDictationHook();
    const start = async (index: number) => {
      await act(async () => {
        result.current.toggleDictation();
      });
      await waitFor(() =>
        expect(MockWebSocket.instances).toHaveLength(index + 1),
      );
      act(() => MockWebSocket.instances[index].emit("open"));
      await waitFor(() =>
        expect(MockWebSocket.instances[index].sentJsonFrames).toContainEqual(
          expect.objectContaining({ type: "start" }),
        ),
      );
      act(() =>
        MockWebSocket.instances[index].emitJson({
          type: "session_state",
          next_chunk_index: 0,
          chunk_duration_ms: 100,
        }),
      );
      await waitFor(() => expect(result.current.isDictating).toBe(true));
    };
    await start(0);
    act(() => result.current.cancelDictation());
    await waitFor(() => expect(result.current.isDictating).toBe(false));
    await start(1);

    act(() => MockWebSocket.instances[0].emit("error"));
    expect(result.current.dictationError).toBeNull();
    act(() => MockWebSocket.instances[1].emit("error"));
    expect(result.current.dictationError).toBe(
      "Audio dictation connection failed.",
    );
  });
});

describe("useAudioDictationRecorder in a conversation the app shell's voice audio has", () => {
  const RATE = 16000;
  const contexts = vi.fn();
  let getUserMedia: ReturnType<typeof vi.fn>;

  /** One shell frame of 512 samples at `value`, as base64 16-bit PCM. */
  const frame = (seq: number, value: number) => {
    const bytes = new Uint8Array(512 * 2);
    const view = new DataView(bytes.buffer);
    for (let index = 0; index < 512; index++)
      view.setInt16(index * 2, Math.round(value * 32767), true);
    emitHostShellEvent("voiceAudio.input", {
      seq,
      at: Date.now(),
      samples: globalThis.btoa(String.fromCharCode(...bytes)),
    });
  };

  beforeEach(async () => {
    vi.restoreAllMocks();
    MockWebSocket.instances.length = 0;
    MockAudioWorkletNode.instances.length = 0;
    vadMock.engines.length = 0;
    vadMock.createRicky0123VadEngine.mockClear();
    contexts.mockClear();
    getUserMedia = vi.fn(async () => new MockMediaStream(true));
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
    vi.stubGlobal(
      "AudioContext",
      class extends MockAudioContext {
        constructor() {
          super();
          contexts();
        }
      },
    );
    vi.stubGlobal("AudioWorkletNode", MockAudioWorkletNode);
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    installHostShell(
      { voiceAudio: 1, audioWhileHidden: 1 },
      shellAnswers({
        "voiceAudio.open": {
          sampleRate: RATE,
          frameSamples: 512,
          output: "speaker",
          outputDelayMs: 40,
          inputDelayMs: 30,
          microphoneMode: "standard",
        },
        "voiceAudio.close": null,
      }),
    );
    await openShellVoiceAudio({ bufferMs: 400, maxWaitMs: 350 });
  });
  afterEach(() => {
    closeShellVoiceAudio();
    removeHostShell();
    Reflect.deleteProperty(navigator, "audioSession");
  });

  const render = () =>
    renderHook(() =>
      useAudioDictationRecorder({
        enabled: true,
        mode: "conversational",
        maxRecordingDurationSeconds: 1200,
        onTranscriptChunk: vi.fn(),
        vadAutoStopEnabled: true,
      }),
    );

  async function listen(hook: ReturnType<typeof render>) {
    await act(async () => {
      hook.result.current.toggleDictation();
    });
    await waitFor(() => expect(hook.result.current.isDictating).toBe(true));
  }

  it("listens through the shell, with no microphone, context or worklet of its own", async () => {
    const hook = render();
    await listen(hook);

    expect(getUserMedia).not.toHaveBeenCalled();
    expect(contexts).not.toHaveBeenCalled();
    expect(MockAudioWorkletNode.instances).toHaveLength(0);
    expect(isAudioCaptureLive()).toBe(true);
  });

  it("hands the shell's frames to the detector at 16 kHz and, once speech is heard, to the transcription", async () => {
    const hook = render();
    await listen(hook);
    act(() => frame(1, 0.25));

    const accepted = vadMock.engines[0].acceptedFrames.at(-1) as {
      samples: Float32Array;
      sampleRate: number;
    };
    expect(accepted.sampleRate).toBe(RATE);
    expect(accepted.samples).toHaveLength(512);
    expect(accepted.samples[0]).toBeCloseTo(0.25, 3);

    act(() => hearSpeech());
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    act(() => MockWebSocket.instances[0].emit("open"));
    await waitFor(() =>
      expect(MockWebSocket.instances[0].sentJsonFrames).toContainEqual(
        expect.objectContaining({ type: "start" }),
      ),
    );
    act(() =>
      MockWebSocket.instances[0].emitJson({
        type: "session_state",
        next_chunk_index: 0,
        chunk_duration_ms: 32,
      }),
    );
    await waitFor(() =>
      expect(
        MockWebSocket.instances[0].sentBinaryFrames.length,
      ).toBeGreaterThan(0),
    );
    const sent = MockWebSocket.instances[0].sentBinaryFrames.length;
    act(() => frame(2, 0.25));
    await waitFor(() =>
      expect(
        MockWebSocket.instances[0].sentBinaryFrames.length,
      ).toBeGreaterThan(sent),
    );
  });

  it("leaves the page's audio session to the shell", async () => {
    const audioSession = { type: "auto" };
    Object.defineProperty(navigator, "audioSession", {
      configurable: true,
      value: audioSession,
    });
    const hook = render();
    await listen(hook);
    expect(audioSession.type).toBe("auto");
  });

  it("reports the microphone lost when the shell closes its voice audio", async () => {
    const hook = render();
    await listen(hook);

    act(() =>
      emitHostShellEvent("voiceAudio.closed", { reason: "mediaServicesReset" }),
    );

    await waitFor(() => expect(hook.result.current.isDictating).toBe(false));
    expect(hook.result.current.dictationError).toMatch(/disconnected/);
  });

  it("reports an interruption only once it outlives the mute grace", async () => {
    const hook = render();
    await listen(hook);
    vi.useFakeTimers();
    try {
      act(() =>
        emitHostShellEvent("voiceAudio.interrupted", { reason: "system" }),
      );
      act(() => vi.advanceTimersByTime(MUTE_GRACE_MS - 1));
      act(() => emitHostShellEvent("voiceAudio.resumed", {}));
      act(() => vi.advanceTimersByTime(MUTE_GRACE_MS));
      expect(hook.result.current.isDictating).toBe(true);

      act(() =>
        emitHostShellEvent("voiceAudio.interrupted", { reason: "system" }),
      );
      act(() => vi.advanceTimersByTime(MUTE_GRACE_MS));
    } finally {
      vi.useRealTimers();
    }
    await waitFor(() => expect(hook.result.current.isDictating).toBe(false));
    expect(hook.result.current.dictationError).toMatch(/stopped sending audio/);
  });

  it("opens the page's own microphone for a dictation outside the conversation", async () => {
    const hook = renderHook(() =>
      useAudioDictationRecorder({
        enabled: true,
        mode: "dictation",
        maxRecordingDurationSeconds: 1200,
        onTranscriptChunk: vi.fn(),
      }),
    );
    await act(async () => {
      hook.result.current.toggleDictation();
    });
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce());
  });
});
