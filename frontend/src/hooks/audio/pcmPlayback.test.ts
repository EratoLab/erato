import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { START_BUFFER_MS, START_WAIT_MS, createPcmQueue } from "./pcmPlayback";

const RATE = 24000;

class MockContext {
  currentTime = 0;
  destination = {};
  started: { at: number; duration: number }[] = [];
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
    const source = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      stop: vi.fn(),
      buffer: null as { duration: number } | null,
      onended: null as (() => void) | null,
      start: (at: number) =>
        this.started.push({ at, duration: source.buffer?.duration ?? 0 }),
    };
    return source;
  }
}

/** Base64 PCM of `ms` milliseconds of silence. */
const pcm = (ms: number) =>
  globalThis.btoa(
    String.fromCharCode(...new Uint8Array(((RATE * ms) / 1000) * 2)),
  );

const context = () => new MockContext() as unknown as AudioContext;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("starting a voice from silence", () => {
  it("does not play the stream's first 200 ms alone before its pause", () => {
    const queue = createPcmQueue(vi.fn());
    const ctx = context();
    const started = (ctx as unknown as MockContext).started;
    // As measured: 171 + 29 ms at once, then nothing for 0.3 to 0.7 s.
    queue.enqueue(ctx, pcm(171), RATE);
    queue.enqueue(ctx, pcm(29), RATE);
    expect(started).toHaveLength(0);
    expect(queue.active).toBe(true);

    vi.advanceTimersByTime(300);
    queue.enqueue(ctx, pcm(240), RATE);
    // 440 ms buffered: all of it plays back to back, without a gap.
    expect(started).toHaveLength(3);
    for (let i = 1; i < started.length; i += 1)
      expect(started[i].at).toBeCloseTo(
        started[i - 1].at + started[i - 1].duration,
        6,
      );
  });

  it("waits at most a moment for the rest", () => {
    const queue = createPcmQueue(vi.fn());
    const ctx = context();
    queue.enqueue(ctx, pcm(200), RATE);
    vi.advanceTimersByTime(START_WAIT_MS - 1);
    expect((ctx as unknown as MockContext).started).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect((ctx as unknown as MockContext).started).toHaveLength(1);
  });

  it("starts at once with enough audio, or a whole short sentence", () => {
    const queue = createPcmQueue(vi.fn());
    const ctx = context();
    queue.enqueue(ctx, pcm(START_BUFFER_MS), RATE);
    expect((ctx as unknown as MockContext).started).toHaveLength(1);

    const short = createPcmQueue(vi.fn());
    const other = context();
    short.enqueue(other, pcm(150), RATE);
    short.flush();
    expect((other as unknown as MockContext).started).toHaveLength(1);
  });

  it("follows on at once while it plays, and a stop forgets what waits", () => {
    const drained = vi.fn();
    const queue = createPcmQueue(drained);
    const ctx = context();
    queue.enqueue(ctx, pcm(500), RATE);
    queue.enqueue(ctx, pcm(50), RATE);
    expect((ctx as unknown as MockContext).started).toHaveLength(2);

    const waiting = createPcmQueue(drained);
    const other = context();
    waiting.enqueue(other, pcm(100), RATE);
    waiting.stop();
    vi.advanceTimersByTime(START_WAIT_MS);
    expect((other as unknown as MockContext).started).toHaveLength(0);
    expect(waiting.active).toBe(false);
    expect(drained).not.toHaveBeenCalled();
  });

  it("keeps waiting audio when paused, to be said again", () => {
    const queue = createPcmQueue(vi.fn());
    const ctx = context();
    const first = pcm(100);
    queue.enqueue(ctx, first, RATE);
    expect(queue.pause(ctx)).toEqual([{ audio: first, sampleRate: RATE }]);
    expect(queue.active).toBe(false);
  });
});
