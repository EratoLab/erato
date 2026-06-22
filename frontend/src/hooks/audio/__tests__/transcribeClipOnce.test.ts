import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { transcribeClipOnce } from "../transcribeClipOnce";

type Listener = (event: { data?: string | ArrayBuffer }) => void;

/**
 * Minimal dictation-socket stand-in: emits `open`, answers `start` with
 * `session_state`, and answers the binary chunk with `chunk_transcribed`.
 * Responses are deferred to a macrotask so the protocol helpers' listeners
 * are attached before a frame is delivered (the real socket is async too).
 */
class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];
  static transcript: string | null = "hello world";
  static failOnStart = false;

  binaryType = "blob";
  readyState = 0;
  sentBinaryFrames = 0;
  private listeners = new Map<string, Set<Listener>>();

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.emit("open", {});
    }, 0);
  }

  addEventListener(type: string, listener: Listener) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: string | ArrayBuffer) {
    if (typeof data === "string") {
      const frame = JSON.parse(data) as Record<string, unknown>;
      if (frame.type === "start") {
        setTimeout(() => {
          if (MockWebSocket.failOnStart) {
            this.emit("message", {
              data: JSON.stringify({ type: "error", error: "boom" }),
            });
          } else {
            this.emit("message", {
              data: JSON.stringify({
                type: "session_state",
                next_chunk_index: 0,
              }),
            });
          }
        }, 0);
      }
      return;
    }
    this.sentBinaryFrames += 1;
    setTimeout(() => {
      this.emit("message", {
        data: JSON.stringify({
          type: "chunk_transcribed",
          chunk_index: 0,
          transcript: MockWebSocket.transcript,
        }),
      });
    }, 0);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.emit("close", {});
  }

  private emit(type: string, event: { data?: string | ArrayBuffer }) {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }
}

function clip(): Float32Array {
  const samples = new Float32Array(1600);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.sin((2 * Math.PI * 440 * index) / 16_000) * 0.3;
  }
  return samples;
}

describe("transcribeClipOnce", () => {
  beforeEach(() => {
    MockWebSocket.instances.length = 0;
    MockWebSocket.transcript = "hello world";
    MockWebSocket.failOnStart = false;
    vi.stubGlobal("WebSocket", MockWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the transcript and sends exactly one binary chunk", async () => {
    const result = await transcribeClipOnce({
      samples: clip(),
      sampleRate: 16_000,
    });
    expect(result).toBe("hello world");
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].sentBinaryFrames).toBe(1);
    expect(MockWebSocket.instances[0].binaryType).toBe("arraybuffer");
    expect(MockWebSocket.instances[0].readyState).toBe(MockWebSocket.CLOSED);
  });

  it("returns an empty string for an empty clip without opening a socket", async () => {
    const result = await transcribeClipOnce({
      samples: new Float32Array(0),
      sampleRate: 16_000,
    });
    expect(result).toBe("");
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it("normalizes a null/blank transcript to an empty string", async () => {
    MockWebSocket.transcript = null;
    const result = await transcribeClipOnce({
      samples: clip(),
      sampleRate: 16_000,
    });
    expect(result).toBe("");
  });

  it("rejects when the server sends an error frame", async () => {
    MockWebSocket.failOnStart = true;
    await expect(
      transcribeClipOnce({ samples: clip(), sampleRate: 16_000 }),
    ).rejects.toThrow(/boom/);
    // Socket is still closed on the error path.
    expect(MockWebSocket.instances[0].readyState).toBe(MockWebSocket.CLOSED);
  });
});
