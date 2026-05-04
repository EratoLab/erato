import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderHook, act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAudioTranscriptionRecorder } from "../useAudioTranscriptionRecorder";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const mockFetchGetFile = vi.fn();
const mockUseCreateChat = vi.fn();

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  fetchGetFile: (...args: unknown[]) => mockFetchGetFile(...args),
  useCreateChat: () => mockUseCreateChat(),
}));

vi.mock("@/lib/generated/v1betaApi/v1betaApiContext", () => ({
  useV1betaApiContext: () => ({ fetcherOptions: {} }),
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
} satisfies FileUploadItem;

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
  fftSize = 64;
  frequencyBinCount = 32;

  disconnect = vi.fn();

  getByteFrequencyData(data: Uint8Array) {
    data.fill(16);
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

class MockMediaRecorder extends EventTarget {
  static instances: MockMediaRecorder[] = [];
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor() {
    super();
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

      if (frame.type === "start") {
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

  private emitJson(frame: Record<string, unknown>) {
    globalThis.queueMicrotask(() =>
      this.emit("message", { data: JSON.stringify(frame) }),
    );
  }

  private emit(type: string, event: MockWebSocketEvent) {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }
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

describe("useAudioTranscriptionRecorder", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockFetchGetFile.mockReset();
    mockUseCreateChat.mockReset();
    mockProcessors.length = 0;
    MockMediaRecorder.instances.length = 0;
    MockWebSocket.instances.length = 0;

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
    vi.stubGlobal("MediaRecorder", MockMediaRecorder);
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
});
