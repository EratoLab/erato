import { beforeEach, describe, expect, it, vi } from "vitest";
const starts: number[] = [];
const stops = vi.fn();
class MockAudioContext {
  state = "running";
  currentTime = 1;
  destination = {};
  resume = vi.fn(async () => {});
  createBuffer(_channels: number, length: number, rate: number) {
    return {
      duration: length / rate,
      getChannelData: () => new Float32Array(length),
    };
  }
  createGain() {
    return {
      context: this,
      gain: { value: 1, setTargetAtTime: vi.fn() },
      connect: vi.fn(),
    };
  }
  createBufferSource() {
    return {
      connect: vi.fn(),
      disconnect: vi.fn(),
      stop: stops,
      start: (time: number) => starts.push(time),
      buffer: null,
      onended: null,
    };
  }
}
beforeEach(() => {
  vi.resetModules();
  starts.length = 0;
  stops.mockClear();
  vi.stubGlobal("AudioContext", MockAudioContext);
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
  });
});
describe("speech playback", () => {
  it("defaults to enabled without starting playback outside audio mode", async () => {
    const p = await import("./speechPlayback");
    expect(p.useSpeechPlayback.getState().enabled).toBe(true);
    p.beginSpeechResponse();
    p.playSpeechChunk("m1", 0, "AQIDBA==", 24000);
    expect(starts).toHaveLength(0);
  });

  it.each([false, true])(
    "remembers the preference %s after reload",
    async (enabled) => {
      const p = await import("./speechPlayback");
      await p.enableSpeechPlayback(enabled);
      vi.resetModules();
      const reloaded = await import("./speechPlayback");
      expect(reloaded.useSpeechPlayback.getState().enabled).toBe(enabled);
    },
  );

  it("supports playback when localStorage is unavailable", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("Storage unavailable");
      },
      setItem: () => {
        throw new Error("Storage unavailable");
      },
    });
    const p = await import("./speechPlayback");
    expect(p.useSpeechPlayback.getState().enabled).toBe(true);
    p.useSpeechPlayback.setState({ conversational: true });
    await p.enableSpeechPlayback(true);
    p.beginSpeechResponse();
    p.playSpeechChunk("m1", 0, "AQIDBA==", 24000);
    expect(starts).toHaveLength(1);
  });

  it("queues PCM in order and deduplicates replayed events", async () => {
    const p = await import("./speechPlayback");
    p.useSpeechPlayback.setState({ conversational: true });
    await p.enableSpeechPlayback(true);
    p.beginSpeechResponse();
    p.playSpeechChunk("m1", 0, "AQIDBA==", 24000);
    p.playSpeechChunk("m1", 0, "AQIDBA==", 24000);
    p.playSpeechChunk("m1", 1, "AQIDBA==", 24000);
    expect(starts).toHaveLength(2);
    expect(starts[1]).toBeGreaterThan(starts[0]);
    expect(p.useSpeechPlayback.getState().playing).toBe(true);
  });
  it("ignores other responses and stops immediately when disabled", async () => {
    const p = await import("./speechPlayback");
    p.useSpeechPlayback.setState({ conversational: true });
    await p.enableSpeechPlayback(true);
    p.beginSpeechResponse();
    p.playSpeechChunk("m1", 0, "AQIDBA==", 24000);
    p.playSpeechChunk("other", 0, "AQIDBA==", 24000);
    await p.enableSpeechPlayback(false);
    p.playSpeechChunk("m1", 1, "AQIDBA==", 24000);
    expect(starts).toHaveLength(1);
    expect(stops).toHaveBeenCalledOnce();
    expect(p.useSpeechPlayback.getState().playing).toBe(false);
  });
  it("never autoplays history without an explicitly started response", async () => {
    const p = await import("./speechPlayback");
    p.useSpeechPlayback.setState({ conversational: true });
    await p.enableSpeechPlayback(true);
    p.playSpeechChunk("historical", 0, "AQIDBA==", 24000);
    expect(starts).toHaveLength(0);
  });
});

it("keeps a new chat's stream active when its permanent ID arrives", async () => {
  const p = await import("./speechPlayback");
  p.useSpeechPlayback.setState({ conversational: true });
  await p.enableSpeechPlayback(true);
  p.beginSpeechResponse("new-chat");
  p.playSpeechChunk("other", 0, "AQIDBA==", 24000, "old-chat");
  p.moveSpeechStream("new-chat", "created-chat");
  p.playSpeechChunk("m1", 0, "AQIDBA==", 24000, "created-chat");
  expect(starts).toHaveLength(1);
});

it("1.10: reads the answer after a decision back when the stopped turn was spoken", async () => {
  const p = await import("./speechPlayback");
  p.useSpeechPlayback.setState({ conversational: true, enabled: true });
  // A typed turn, approved after conversational mode was switched on.
  expect(p.readsBackContinuation("chat-1")).toBe(false);
  p.beginSpeechResponse("chat-1");
  expect(p.readsBackContinuation("chat-1")).toBe(true);
  expect(p.readsBackContinuation("chat-2")).toBe(false);
  // A stop keeps the turn spoken; the quiet ends with the next response.
  p.quietSpokenTurn();
  expect(p.useSpeechPlayback.getState().quietTurn).toBe("chat-1");
  expect(p.readsBackContinuation("chat-1")).toBe(true);
  p.beginSpeechResponse("chat-1");
  expect(p.useSpeechPlayback.getState().quietTurn).toBeUndefined();
});

it("lowers every voice while the user may be talking over it, and restores it", async () => {
  const p = await import("./speechPlayback");
  const playback = await import("./pcmPlayback");
  p.useSpeechPlayback.setState({ conversational: true });
  await p.enableSpeechPlayback(true);
  const context = playback.playbackContext() as unknown as MockAudioContext;
  const createGain = vi.spyOn(context, "createGain");
  p.beginSpeechResponse("chat-1");
  p.playSpeechChunk("m1", 0, "AQIDBA==", 24000, "chat-1");
  p.playSpeechChunk("m1", 1, "AQIDBA==", 24000, "chat-1");
  // One output for every chunk, so lowering it lowers the whole voice.
  expect(createGain).toHaveBeenCalledTimes(1);
  const output = createGain.mock.results[0].value as ReturnType<
    MockAudioContext["createGain"]
  >;
  playback.lowerVoice(true);
  expect(output.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.3, 1, 0.03);
  playback.lowerVoice(false);
  expect(output.gain.setTargetAtTime).toHaveBeenLastCalledWith(1, 1, 0.03);
});

describe("talking over a reply", () => {
  const speaking = async () => {
    const p = await import("./speechPlayback");
    p.useSpeechPlayback.setState({ conversational: true });
    await p.enableSpeechPlayback(true);
    p.beginSpeechResponse("chat-1");
    p.playSpeechChunk("m1", 0, "AQIDBA==", 24000, "chat-1");
    p.playSpeechChunk("m1", 1, "AQIDBA==", 24000, "chat-1");
    expect(starts).toHaveLength(2);
    return p;
  };

  it("pauses at once and keeps what was not said, and what arrives meanwhile", async () => {
    const p = await speaking();
    p.pauseSpeechPlayback();
    expect(stops).toHaveBeenCalledTimes(2);
    expect(p.useSpeechPlayback.getState()).toMatchObject({
      playing: false,
      paused: true,
    });
    p.playSpeechChunk("m1", 2, "AQIDBA==", 24000, "chat-1");
    expect(starts).toHaveLength(2);

    p.resumeSpeechPlayback();
    // Both cut chunks from their start, then the one that arrived.
    expect(starts).toHaveLength(5);
    expect(p.useSpeechPlayback.getState()).toMatchObject({
      playing: true,
      paused: false,
    });
    p.playSpeechChunk("m1", 3, "AQIDBA==", 24000, "chat-1");
    expect(starts).toHaveLength(6);
  });

  it("a turn with words drops what the paused voice kept", async () => {
    const p = await speaking();
    p.pauseSpeechPlayback();
    p.stopSpeechPlayback();
    p.resumeSpeechPlayback();
    p.playSpeechChunk("m1", 2, "AQIDBA==", 24000, "chat-1");
    expect(starts).toHaveLength(2);
    expect(p.useSpeechPlayback.getState()).toMatchObject({
      playing: false,
      paused: false,
    });
    // The turn stays spoken, so a card it stops on is still said.
    expect(p.useSpeechPlayback.getState().quietTurn).toBeUndefined();
  });

  it("a new response ends a pause", async () => {
    const p = await speaking();
    p.pauseSpeechPlayback();
    p.beginSpeechResponse("chat-1");
    expect(p.useSpeechPlayback.getState().paused).toBe(false);
    p.resumeSpeechPlayback();
    expect(starts).toHaveLength(2);
  });
});
