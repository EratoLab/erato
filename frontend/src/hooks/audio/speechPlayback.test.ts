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
});
describe("speech playback", () => {
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
