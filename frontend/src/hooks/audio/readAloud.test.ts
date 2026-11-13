import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SSEOptions } from "@/utils/sse/sseClient";

interface MockSource {
  start: (time: number) => void;
  stop: () => void;
  onended: (() => void) | null;
}
interface Connection {
  url: string;
  options: SSEOptions;
  close: ReturnType<typeof vi.fn>;
}

const sources: MockSource[] = [];
const starts: number[] = [];
const stops = vi.fn();
const connections: Connection[] = [];
let contextState = "running";

class MockAudioContext {
  get state() {
    return contextState;
  }
  currentTime = 1;
  destination = {};
  resume = vi.fn(async () => {});
  createBuffer(_channels: number, length: number, rate: number) {
    return {
      duration: length / rate,
      getChannelData: () => new Float32Array(length),
    };
  }
  createBufferSource() {
    const source = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      stop: stops,
      start: (time: number) => starts.push(time),
      buffer: null,
      onended: null,
    };
    sources.push(source);
    return source;
  }
}

vi.mock("@/utils/sse/sseClient", () => ({
  createSSEConnection: (url: string, options: SSEOptions) => {
    const connection: Connection = {
      url,
      options,
      close: vi.fn(() => options.onClose?.()),
    };
    connections.push(connection);
    return connection.close;
  },
}));

const delta = (sequence: number, audio = "AQIDBA==") => ({
  type: "audio_delta",
  data: JSON.stringify({
    message_type: "audio_delta",
    sequence,
    audio,
    sample_rate: 24000,
  }),
});
const done = { type: "done", data: '{"message_type":"done"}' };

async function start(messageId: string) {
  const readAloud = await import("./readAloud");
  const before = connections.length;
  readAloud.startReadAloud(messageId);
  await vi.waitFor(() => expect(connections).toHaveLength(before + 1));
  return { readAloud, connection: connections[before] };
}

beforeEach(() => {
  vi.resetModules();
  sources.length = 0;
  starts.length = 0;
  connections.length = 0;
  stops.mockClear();
  contextState = "running";
  vi.stubGlobal("AudioContext", MockAudioContext);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("read aloud", () => {
  it("requests the message's speech and plays its chunks in order", async () => {
    const { readAloud, connection } = await start("m1");
    expect(connection.url).toBe("/api/v1beta/me/messages/m1/speech");
    expect(connection.options.method).toBe("POST");
    expect(readAloud.useReadAloud.getState()).toMatchObject({
      messageId: "m1",
      status: "loading",
    });

    connection.options.onMessage?.(delta(0));
    connection.options.onMessage?.(delta(0));
    connection.options.onMessage?.(delta(1));

    expect(starts).toHaveLength(2);
    expect(starts[1]).toBeGreaterThan(starts[0]);
    expect(readAloud.useReadAloud.getState().status).toBe("playing");
  });

  it("keeps playing queued audio after the stream is done and ends with its last chunk", async () => {
    const { readAloud, connection } = await start("m1");
    connection.options.onMessage?.(delta(0));
    connection.options.onMessage?.(delta(1));
    connection.options.onMessage?.(done);
    connection.options.onClose?.();
    expect(readAloud.useReadAloud.getState().status).toBe("playing");

    sources[0].onended?.();
    expect(readAloud.useReadAloud.getState().status).toBe("playing");
    sources[1].onended?.();

    expect(readAloud.useReadAloud.getState()).toMatchObject({
      messageId: null,
      status: null,
    });
  });

  it("stays in the playing state while a later passage is still being synthesised", async () => {
    const { readAloud, connection } = await start("m1");
    connection.options.onMessage?.(delta(0));
    sources[0].onended?.();

    expect(readAloud.useReadAloud.getState()).toMatchObject({
      messageId: "m1",
      status: "playing",
    });
  });

  it("stop closes the request and silences what is queued", async () => {
    const { readAloud, connection } = await start("m1");
    connection.options.onMessage?.(delta(0));

    readAloud.stopReadAloud();

    expect(connection.close).toHaveBeenCalledOnce();
    expect(stops).toHaveBeenCalledOnce();
    expect(readAloud.useReadAloud.getState()).toMatchObject({
      messageId: null,
      status: null,
    });
    connection.options.onMessage?.(delta(1));
    expect(starts).toHaveLength(1);
  });

  it("plays one message at a time: starting another ends the first", async () => {
    const first = await start("m1");
    first.connection.options.onMessage?.(delta(0));
    const second = await start("m2");

    expect(first.connection.close).toHaveBeenCalledOnce();
    expect(stops).toHaveBeenCalledOnce();
    expect(second.readAloud.useReadAloud.getState()).toMatchObject({
      messageId: "m2",
      status: "loading",
    });
    // The first message's stopped audio ending must not end the second.
    second.connection.options.onMessage?.(done);
    first.connection.options.onMessage?.(delta(1));
    expect(starts).toHaveLength(1);
  });

  it("toggling the message that is playing stops it, another message starts", async () => {
    const { readAloud, connection } = await start("m1");
    connection.options.onMessage?.(delta(0));

    readAloud.toggleReadAloud("m1");
    expect(readAloud.useReadAloud.getState().messageId).toBeNull();

    readAloud.toggleReadAloud("m2");
    expect(readAloud.useReadAloud.getState()).toMatchObject({
      messageId: "m2",
      status: "loading",
    });
  });

  it.each([
    [
      "an error event",
      (c: Connection) =>
        c.options.onMessage?.({
          type: "error",
          data: '{"message_type":"error"}',
        }),
    ],
    [
      "a failed request",
      (c: Connection) => c.options.onError?.(new Error("404")),
    ],
    [
      "a stream that ends without done",
      (c: Connection) => c.options.onClose?.(),
    ],
    [
      "audio that is not PCM",
      (c: Connection) => c.options.onMessage?.(delta(0, "AQID")),
    ],
  ])("shows a short failed state after %s", async (_name, trigger) => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { readAloud, connection } = await start("m1");

    trigger(connection);

    expect(readAloud.useReadAloud.getState()).toMatchObject({
      messageId: "m1",
      status: "failed",
    });
    vi.advanceTimersByTime(5000);
    expect(readAloud.useReadAloud.getState()).toMatchObject({
      messageId: null,
      status: null,
    });
  });

  it("fails without a request when the browser keeps audio output blocked", async () => {
    contextState = "suspended";
    const readAloud = await import("./readAloud");

    readAloud.startReadAloud("m1");

    await vi.waitFor(() =>
      expect(readAloud.useReadAloud.getState().status).toBe("failed"),
    );
    expect(connections).toHaveLength(0);
  });

  it("entering an audio mode ends playback and is remembered for the button", async () => {
    const { readAloud, connection } = await start("m1");
    connection.options.onMessage?.(delta(0));

    readAloud.setReadAloudAudioModeActive(true);

    expect(connection.close).toHaveBeenCalledOnce();
    expect(readAloud.useReadAloud.getState()).toMatchObject({
      messageId: null,
      status: null,
      audioModeActive: true,
    });
    readAloud.setReadAloudAudioModeActive(false);
    expect(readAloud.useReadAloud.getState().audioModeActive).toBe(false);
  });
});
