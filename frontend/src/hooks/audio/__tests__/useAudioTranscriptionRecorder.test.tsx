import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderHook, act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAudioTranscriptionRecorder } from "../useAudioTranscriptionRecorder";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const mockFetchGetFile = vi.fn();
const mockUseCreateChat = vi.fn();
const mockCreateRicky0123VadEngine = vi.fn();

type MockVoiceVadListener = (event: {
  type: string;
  timestampMs?: number;
  audio?: Float32Array;
}) => void;

const mockVadListeners: MockVoiceVadListener[] = [];
const mockVadEngine = {
  start: vi.fn(async () => {}),
  stop: vi.fn(),
  destroy: vi.fn(),
  acceptFrame: vi.fn(async () => {}),
  subscribe: vi.fn((listener: MockVoiceVadListener) => {
    mockVadListeners.push(listener);
    return () => {
      const index = mockVadListeners.indexOf(listener);
      if (index >= 0) {
        mockVadListeners.splice(index, 1);
      }
    };
  }),
};

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  fetchGetFile: (...args: unknown[]) => mockFetchGetFile(...args),
  useCreateChat: () => mockUseCreateChat(),
}));

vi.mock("@/lib/generated/v1betaApi/v1betaApiContext", () => ({
  useV1betaApiContext: () => ({ fetcherOptions: {} }),
}));

vi.mock("@/lib/voice-runtime", () => ({
  createRicky0123VadEngine: (...args: unknown[]) =>
    mockCreateRicky0123VadEngine(...args),
}));

vi.mock("../audio-dictation-worklet.ts?worker&url", () => ({
  default: "blob:mock-audio-dictation-worklet",
}));

const fixturePath = join(
  process.cwd(),
  "src/hooks/audio/__tests__/fixtures/sales-summary-1-3.wav",
);

const audioFileUpload = {
  id: "audio-live-file",
  filename: "audio-recording.wav",
  download_url: "/files/audio-live-file",
  preview_url: undefined,
  file_contents_unavailable_missing_permissions: false,
  file_capability: {
    extensions: ["wav"],
    id: "audio",
    mime_types: ["audio/wav"],
    operations: ["extract_text"],
  },
  audio_transcription: {
    status: "recording",
    progress: 0,
    chunks: [],
  },
} as unknown as FileUploadItem;

function readCanonicalWavSamples(): Float32Array {
  const wavBytes = readFileSync(fixturePath);
  const view = new DataView(
    wavBytes.buffer,
    wavBytes.byteOffset,
    wavBytes.byteLength,
  );
  const pcmBytes = wavBytes.subarray(44);
  const samples = new Float32Array(pcmBytes.length / 2);

  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = view.getInt16(44 + index * 2, true) / 0x8000;
  }

  return samples;
}

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
  /** When false, the mock withholds the automatic session_state reply so
   *  tests can drive the handshake manually (pre-handshake capture). */
  static autoRespondSessionState = true;
  readyState = MockWebSocket.OPEN;
  sentJsonFrames: Record<string, unknown>[] = [];
  sentBinaryFrames: Uint8Array[] = [];
  private listeners = new Map<
    string,
    Set<(event: MockWebSocketEvent) => void>
  >();
  private pendingChunkIndex: number | null = null;

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
    globalThis.queueMicrotask(() => this.emit("open", {}));
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

      if (frame.type === "start" && MockWebSocket.autoRespondSessionState) {
        this.emitJson({
          type: "session_state",
          file_upload_id: audioFileUpload.id,
          next_chunk_index: 0,
          stored_offset: 0,
          chunk_duration_ms: 100,
          audio_transcription: audioFileUpload.audio_transcription,
        });
      }

      if (frame.type === "chunk_metadata") {
        this.pendingChunkIndex = Number(frame.chunk_index);
      }

      if (frame.type === "finish") {
        this.emitJson({
          type: "completed",
          file_upload_id: audioFileUpload.id,
          transcript: "live chunk 0 live chunk 1",
          audio_transcription: {
            status: "completed",
            progress: 1,
            transcript: "live chunk 0 live chunk 1",
            chunks: [
              {
                attempts: 1,
                byte_end: 3244,
                byte_start: 0,
                error: null,
                index: 0,
                start_ms: 0,
                end_ms: 100,
                status: "completed",
                transcript: "live chunk 0",
              },
              {
                attempts: 1,
                byte_end: 6444,
                byte_start: 3244,
                error: null,
                index: 1,
                start_ms: 100,
                end_ms: 200,
                status: "completed",
                transcript: "live chunk 1",
              },
            ],
          },
        });
      }
      return;
    }

    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.sentBinaryFrames.push(bytes);
    const chunkIndex = this.pendingChunkIndex ?? 0;
    this.emitJson({
      type: "chunk_ack",
      file_upload_id: audioFileUpload.id,
      chunk_index: chunkIndex,
      byte_start: chunkIndex * 3200,
      byte_end: chunkIndex * 3200 + bytes.length,
    });
    this.emitJson({
      type: "chunk_transcribed",
      file_upload_id: audioFileUpload.id,
      chunk_index: chunkIndex,
      transcript: `live chunk ${chunkIndex}`,
      audio_transcription: {
        status: "recording",
        progress: 0.5,
        transcript: `live chunk ${chunkIndex}`,
        chunks: [
          {
            attempts: 1,
            byte_end: chunkIndex * 3200 + bytes.length,
            byte_start: chunkIndex * 3200,
            error: null,
            index: chunkIndex,
            start_ms: chunkIndex * 100,
            end_ms: chunkIndex * 100 + 100,
            status: "completed",
            transcript: `live chunk ${chunkIndex}`,
          },
        ],
      },
    });
  }

  close = vi.fn(() => {
    this.readyState = 3;
    this.emit("close", {});
  });

  emitJson(frame: Record<string, unknown>) {
    globalThis.queueMicrotask(() =>
      this.emit("message", { data: JSON.stringify(frame) }),
    );
  }

  private emit(type: string, event: MockWebSocketEvent) {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }
}

function emitAudioSamples(samples: Float32Array) {
  const processor = MockAudioWorkletNode.instances.at(-1);
  if (!processor?.port.onmessage) {
    throw new Error("Audio worklet node was not initialized");
  }

  processor.port.onmessage({ data: samples } as MessageEvent<Float32Array>);
}

describe("useAudioTranscriptionRecorder", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockFetchGetFile.mockReset();
    mockUseCreateChat.mockReset();
    MockAudioWorkletNode.instances.length = 0;
    MockWebSocket.instances.length = 0;
    MockWebSocket.autoRespondSessionState = true;
    mockVadListeners.length = 0;
    mockVadEngine.start.mockClear();
    mockVadEngine.stop.mockClear();
    mockVadEngine.destroy.mockClear();
    mockVadEngine.acceptFrame.mockClear();
    mockVadEngine.subscribe.mockClear();
    mockCreateRicky0123VadEngine.mockReset();
    mockCreateRicky0123VadEngine.mockReturnValue(mockVadEngine);

    mockUseCreateChat.mockReturnValue({
      mutateAsync: vi.fn(async () => ({ chat_id: "chat-created-for-audio" })),
    });
    mockFetchGetFile.mockResolvedValue(audioFileUpload);

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

  it("opens the websocket when recording starts and streams live WAV chunks from a fixture", async () => {
    let attachedFiles: FileUploadItem[] = [];
    const setSilentChatId = vi.fn();
    let rerenderHook = () => {};
    const setAttachedFiles = vi.fn((nextAttachedFiles: FileUploadItem[]) => {
      attachedFiles = nextAttachedFiles;
      rerenderHook();
    });
    const { result, rerender } = renderHook(() =>
      useAudioTranscriptionRecorder({
        audioTranscriptionEnabled: true,
        uploadEnabled: true,
        maxRecordingDurationSeconds: 1200,
        chatId: "chat-1",
        silentChatId: null,
        setSilentChatId,
        selectedModel: {
          chat_provider_id: "gemini-2-5-flash-lite",
          model_display_name: "Gemini",
        },
        attachedFiles,
        setAttachedFiles,
      }),
    );
    rerenderHook = rerender;

    await act(async () => {
      result.current.toggleAudioRecording();
    });

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    await waitFor(() =>
      expect(MockWebSocket.instances[0].sentJsonFrames).toContainEqual(
        expect.objectContaining({ type: "start", chat_id: "chat-1" }),
      ),
    );
    await waitFor(() => expect(mockFetchGetFile).toHaveBeenCalled());
    await waitFor(() => expect(result.current.isRecording).toBe(true));

    const samples = readCanonicalWavSamples();
    act(() => {
      emitAudioSamples(samples.slice(0, 16_000));
    });

    await waitFor(() =>
      expect(
        MockWebSocket.instances[0].sentBinaryFrames.length,
      ).toBeGreaterThan(1),
    );
    expect(MockWebSocket.instances[0].sentJsonFrames).toContainEqual(
      expect.objectContaining({
        type: "chunk_metadata",
        chunk_index: 0,
        content_type: "audio/wav",
      }),
    );
    expect(MockWebSocket.instances[0].sentJsonFrames).toContainEqual(
      expect.objectContaining({
        type: "chunk_metadata",
        chunk_index: 1,
        content_type: "audio/pcm",
      }),
    );
    await waitFor(() =>
      expect(setAttachedFiles).toHaveBeenCalledWith([
        expect.objectContaining({
          id: audioFileUpload.id,
          audio_transcription: expect.objectContaining({
            transcript: "live chunk 0",
          }),
        }),
      ]),
    );

    await act(async () => {
      result.current.toggleAudioRecording();
    });

    await waitFor(() =>
      expect(MockWebSocket.instances[0].sentJsonFrames).toContainEqual(
        expect.objectContaining({ type: "finish" }),
      ),
    );
    await waitFor(() =>
      expect(setAttachedFiles).toHaveBeenCalledWith([
        expect.objectContaining({
          id: audioFileUpload.id,
          audio_transcription: expect.objectContaining({
            status: "completed",
            transcript: "live chunk 0 live chunk 1",
          }),
        }),
      ]),
    );
  });

  it("captures speech during the socket handshake and ships it once the session is ready", async () => {
    MockWebSocket.autoRespondSessionState = false;
    let attachedFiles: FileUploadItem[] = [];
    const setAttachedFiles = vi.fn((nextAttachedFiles: FileUploadItem[]) => {
      attachedFiles = nextAttachedFiles;
    });
    const { result } = renderHook(() =>
      useAudioTranscriptionRecorder({
        audioTranscriptionEnabled: true,
        uploadEnabled: true,
        maxRecordingDurationSeconds: 1200,
        chatId: "chat-1",
        silentChatId: null,
        setSilentChatId: vi.fn(),
        attachedFiles,
        setAttachedFiles,
      }),
    );

    await act(async () => {
      result.current.toggleAudioRecording();
    });

    // Regression test for ERMAIN-334's tap-after-handshake truncation:
    // the worklet must already be capturing while the server has NOT
    // yet replied with session_state.
    await waitFor(() => expect(MockAudioWorkletNode.instances).toHaveLength(1));
    await waitFor(() =>
      expect(MockWebSocket.instances[0].sentJsonFrames).toContainEqual(
        expect.objectContaining({ type: "start" }),
      ),
    );

    // Speak during the handshake: samples buffer client-side and
    // nothing is transmitted yet.
    act(() => {
      emitAudioSamples(new Float32Array(1600).fill(0.5));
    });
    expect(MockWebSocket.instances[0].sentBinaryFrames).toHaveLength(0);
    expect(result.current.isRecording).toBe(false);

    // Server completes the handshake.
    await act(async () => {
      MockWebSocket.instances[0].emitJson({
        type: "session_state",
        file_upload_id: audioFileUpload.id,
        next_chunk_index: 0,
        stored_offset: 0,
        chunk_duration_ms: 100,
        audio_transcription: audioFileUpload.audio_transcription,
      });
    });
    await waitFor(() => expect(result.current.isRecording).toBe(true));

    // The 300ms zero primer (4800 samples at the mocked 16kHz rate) plus
    // the 1600 pre-handshake speech samples drain into exactly four
    // 100ms chunks: three zero primer chunks, then the speech.
    await waitFor(() =>
      expect(MockWebSocket.instances[0].sentBinaryFrames).toHaveLength(4),
    );
    const frames = MockWebSocket.instances[0].sentBinaryFrames;
    expect(String.fromCharCode(...frames[0].slice(0, 4))).toBe("RIFF");
    // 0.5 resamples 1:1 at the mocked rate and packs as int16 0x3fff
    // little-endian — the speech spoken during the handshake reached
    // the server instead of being dropped.
    expect(frames[3][0]).toBe(0xff);
    expect(frames[3][1]).toBe(0x3f);
  });

  it("auto-stops a live recording when VAD detects speech end", async () => {
    let attachedFiles: FileUploadItem[] = [];
    const setSilentChatId = vi.fn();
    const onVadAutoStop = vi.fn();
    let rerenderHook = () => {};
    const setAttachedFiles = vi.fn((nextAttachedFiles: FileUploadItem[]) => {
      attachedFiles = nextAttachedFiles;
      rerenderHook();
    });
    const { result, rerender } = renderHook(() =>
      useAudioTranscriptionRecorder({
        audioTranscriptionEnabled: true,
        uploadEnabled: true,
        maxRecordingDurationSeconds: 1200,
        vadAutoStopEnabled: true,
        onVadAutoStop,
        chatId: "chat-1",
        silentChatId: null,
        setSilentChatId,
        attachedFiles,
        setAttachedFiles,
      }),
    );
    rerenderHook = rerender;

    await act(async () => {
      result.current.toggleAudioRecording();
    });

    await waitFor(() => expect(result.current.isRecording).toBe(true));
    expect(mockCreateRicky0123VadEngine).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "silero-v5",
      }),
    );
    expect(mockVadEngine.start).toHaveBeenCalled();
    expect(result.current.isVadListening).toBe(true);

    act(() => {
      emitAudioSamples(new Float32Array(16_000).fill(0.1));
    });

    await waitFor(() => expect(mockVadEngine.acceptFrame).toHaveBeenCalled());

    act(() => {
      mockVadListeners.forEach((listener) =>
        listener({
          type: "speech_end",
          timestampMs: 1000,
          audio: new Float32Array([0.1, 0.2]),
        }),
      );
    });

    expect(onVadAutoStop).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.isRecording).toBe(false));
    await waitFor(() =>
      expect(MockWebSocket.instances[0].sentJsonFrames).toContainEqual(
        expect.objectContaining({ type: "finish" }),
      ),
    );
    expect(mockVadEngine.destroy).toHaveBeenCalled();
  });

  it("does not start VAD when auto-stop is disabled", async () => {
    let attachedFiles: FileUploadItem[] = [];
    const setAttachedFiles = vi.fn((nextAttachedFiles: FileUploadItem[]) => {
      attachedFiles = nextAttachedFiles;
    });
    const { result } = renderHook(() =>
      useAudioTranscriptionRecorder({
        audioTranscriptionEnabled: true,
        uploadEnabled: true,
        maxRecordingDurationSeconds: 1200,
        vadAutoStopEnabled: false,
        chatId: "chat-1",
        silentChatId: null,
        setSilentChatId: vi.fn(),
        attachedFiles,
        setAttachedFiles,
      }),
    );

    await act(async () => {
      result.current.toggleAudioRecording();
    });

    await waitFor(() => expect(result.current.isRecording).toBe(true));
    expect(mockCreateRicky0123VadEngine).not.toHaveBeenCalled();
  });
});
