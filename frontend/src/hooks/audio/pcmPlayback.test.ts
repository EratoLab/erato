import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setPageVisibility } from "@/test/pageVisibility";

import {
  DEFAULT_START_BUFFER_MS as START_BUFFER_MS,
  DEFAULT_START_WAIT_MS as START_WAIT_MS,
  configureVoiceStart,
  createPcmQueue,
} from "./pcmPlayback";

const RATE = 24000;

class MockContext {
  currentTime = 0;
  destination = {};
  started: { at: number; duration: number }[] = [];
  sources: { onended: (() => void) | null }[] = [];
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
    this.sources.push(source);
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
afterEach(() => {
  configureVoiceStart({});
  vi.useRealTimers();
});

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

  it("takes the deployment's start buffer, and plays at once with none", () => {
    configureVoiceStart({ bufferMs: 0 });
    const ctx = context();
    createPcmQueue(vi.fn()).enqueue(ctx, pcm(100), RATE);
    expect((ctx as unknown as MockContext).started).toHaveLength(1);

    configureVoiceStart({ bufferMs: 1000, maxWaitMs: 600 });
    const other = context();
    const queue = createPcmQueue(vi.fn());
    queue.enqueue(other, pcm(500), RATE);
    vi.advanceTimersByTime(START_WAIT_MS);
    expect((other as unknown as MockContext).started).toHaveLength(0);
    vi.advanceTimersByTime(600 - START_WAIT_MS);
    expect((other as unknown as MockContext).started).toHaveLength(1);

    // Out of range: the defaults.
    configureVoiceStart({ bufferMs: -1, maxWaitMs: 99_999 });
    const third = context();
    createPcmQueue(vi.fn()).enqueue(third, pcm(START_BUFFER_MS), RATE);
    expect((third as unknown as MockContext).started).toHaveLength(1);
  });

  it("F3: a voice that runs dry in the middle goes on at once, and a stop starts afresh", () => {
    const queue = createPcmQueue(vi.fn());
    const ctx = context();
    const started = (ctx as unknown as MockContext).started;
    queue.enqueue(ctx, pcm(START_BUFFER_MS), RATE);
    expect(started).toHaveLength(1);
    // The queue runs dry; the stream goes on at its own pace.
    (ctx as unknown as MockContext).sources[0].onended?.();
    expect(queue.active).toBe(false);
    queue.enqueue(ctx, pcm(60), RATE);
    expect(started).toHaveLength(2);

    queue.stop();
    queue.enqueue(ctx, pcm(60), RATE);
    expect(started).toHaveLength(2);
    vi.advanceTimersByTime(START_WAIT_MS);
    expect(started).toHaveLength(3);
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

/**
 * Replays a stream as it arrived, [ms after the first chunk, ms of audio],
 * with the context's clock running, and returns the silences inside it and
 * when its first sound starts, in ms.
 */
function replay(stream: [number, number][]) {
  const mock = new MockContext();
  const base = Date.now();
  Object.defineProperty(mock, "currentTime", {
    get: () => (Date.now() - base) / 1000,
  });
  const queue = createPcmQueue(vi.fn());
  const ctx = mock as unknown as AudioContext;
  for (const [at, ms] of stream) {
    vi.advanceTimersByTime(at - (Date.now() - base));
    queue.enqueue(ctx, pcm(ms), RATE);
  }
  queue.flush();
  const gaps = mock.started
    .slice(1)
    .map((chunk, i) => {
      const before = mock.started[i];
      return Math.round((chunk.at - before.at - before.duration) * 1000);
    })
    .filter((gap) => gap > 0);
  return { gaps, first: Math.round(mock.started[0].at * 1000) };
}

/** The rest of a sentence, faster than it plays as on staging: 2 s in 0.4 s. */
const rest = (from: number): [number, number][] =>
  Array.from({ length: 20 }, (_, i) => [from + i * 20, 100]);

describe("streams as measured", () => {
  it("staging's voice (small chunks, steady): no silence, first sound within 0.1 s", () => {
    // A reply on MS staging, 2026-11-20: the first 12 chunks.
    const { gaps, first } = replay([
      [0, 40],
      [0, 40],
      [19, 120],
      [19, 40],
      [35, 40],
      [35, 40],
      [38, 40],
      [54, 40],
      [54, 80],
      [83, 120],
      [101, 40],
      [101, 40],
      ...rest(120),
    ]);
    expect(gaps).toEqual([]);
    expect(first).toBeLessThanOrEqual(100);
  });

  it.each([290, 450, 550])(
    "the local voice's first pause of %i ms after 200 ms of audio: no silence",
    (pause) => {
      const { gaps, first } = replay([[0, 171], [0, 29], ...rest(pause)]);
      expect(gaps).toEqual([]);
      expect(first).toBeLessThanOrEqual(START_WAIT_MS + 30);
    },
  );

  it("a pause longer than the wait and the audio it holds leaves only the excess", () => {
    // The longest pause measured on 2026-11-18.
    const { gaps } = replay([[0, 171], [0, 29], ...rest(736)]);
    expect(gaps).toEqual([736 - START_WAIT_MS - 200]);
  });
});

describe("the shared playback context after a phone lock", () => {
  const SAFARI_UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";

  /** Runs from creation; after `lock()` it says "running" with a standing clock. */
  class LockableContext {
    static last: LockableContext | undefined;
    state: AudioContextState = "running";
    private standsAt: number | null = null;
    private offset = 0;
    /** Suspend and resume leave the clock standing, as the phone did at times. */
    wedged = false;
    constructor() {
      LockableContext.last = this;
    }
    get currentTime() {
      return this.standsAt ?? Date.now() / 1000 - this.offset;
    }
    lock() {
      this.standsAt = this.currentTime;
    }
    suspend = vi.fn(async () => {
      this.state = "suspended";
    });
    resume = vi.fn(async () => {
      if (
        this.state === "suspended" &&
        this.standsAt !== null &&
        !this.wedged
      ) {
        this.offset = Date.now() / 1000 - this.standsAt;
        this.standsAt = null;
      }
      this.state = "running";
    });
  }

  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("navigator", { userAgent: SAFARI_UA });
    vi.stubGlobal("AudioContext", LockableContext);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("starts its standing clock again once the page is shown", async () => {
    const { resumePlaybackContext } = await import("./pcmPlayback");
    await resumePlaybackContext();
    const playback = LockableContext.last!;

    setPageVisibility("hidden");
    playback.lock();
    setPageVisibility("visible");
    await vi.advanceTimersByTimeAsync(2000);

    const before = playback.currentTime;
    vi.advanceTimersByTime(500);
    expect(playback.currentTime).toBeGreaterThan(before);
    expect(playback.state).toBe("running");
  });

  it("hands read aloud a moving clock when it is tapped right after unlocking", async () => {
    const { resumePlaybackContext } = await import("./pcmPlayback");
    await resumePlaybackContext();
    const playback = LockableContext.last!;
    setPageVisibility("hidden");
    playback.lock();
    setPageVisibility("visible");

    let handed = false;
    const tapped = resumePlaybackContext().then((context) => {
      handed = true;
      return context;
    });
    await vi.advanceTimersByTimeAsync(100);
    // `resume()` alone leaves the clock where it stands.
    expect(handed).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    const context = await tapped;

    expect(playback.suspend).toHaveBeenCalledOnce();
    const before = context.currentTime;
    vi.advanceTimersByTime(500);
    expect(context.currentTime).toBeGreaterThan(before);
  });

  it("keeps taking a voice's audio during the moment the revival suspends it", async () => {
    const { resumePlaybackContext, playbackPlays } = await import(
      "./pcmPlayback"
    );
    await resumePlaybackContext();
    const playback = LockableContext.last!;
    playback.resume.mockImplementation(() => new Promise<void>(() => {}));
    setPageVisibility("hidden");
    playback.lock();
    setPageVisibility("visible");
    await vi.advanceTimersByTimeAsync(400);

    expect(playback.state).toBe("suspended");
    expect(playbackPlays(playback as unknown as AudioContext)).toBe(true);
  });

  it("does not hold voices back for good when a resume never settles", async () => {
    const { resumePlaybackContext } = await import("./pcmPlayback");
    await resumePlaybackContext();
    const playback = LockableContext.last!;
    playback.resume.mockImplementationOnce(() => new Promise<void>(() => {}));
    setPageVisibility("hidden");
    playback.lock();
    setPageVisibility("visible");

    let handed = false;
    void resumePlaybackContext().then(() => {
      handed = true;
    });
    await vi.advanceTimersByTimeAsync(3000);
    expect(handed).toBe(true);
  });

  it("tries again when a voice is about to play, after the revival on return did not take", async () => {
    const { resumePlaybackContext, playbackPlays } = await import(
      "./pcmPlayback"
    );
    await resumePlaybackContext();
    const playback = LockableContext.last!;
    playback.wedged = true;
    setPageVisibility("hidden");
    playback.lock();
    setPageVisibility("visible");
    await vi.advanceTimersByTimeAsync(3000);
    const standing = playback.currentTime;
    vi.advanceTimersByTime(500);
    expect(playback.currentTime).toBe(standing);

    playback.wedged = false;
    expect(playbackPlays(playback as unknown as AudioContext)).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);

    const before = playback.currentTime;
    vi.advanceTimersByTime(500);
    expect(playback.currentTime).toBeGreaterThan(before);
  });

  it("does not count a context that is not running as playing while a retry is due", async () => {
    const { resumePlaybackContext, playbackPlays } = await import(
      "./pcmPlayback"
    );
    await resumePlaybackContext();
    const playback = LockableContext.last!;
    playback.wedged = true;
    setPageVisibility("hidden");
    playback.lock();
    setPageVisibility("visible");
    await vi.advanceTimersByTimeAsync(3000);
    vi.advanceTimersByTime(2500);

    playback.state = "interrupted" as AudioContextState;
    expect(playbackPlays(playback as unknown as AudioContext)).toBe(false);
    expect(playback.suspend).toHaveBeenCalledTimes(3);
  });

  it("tries a clock that stays standing again at most every 2 s and five times per return", async () => {
    const { resumePlaybackContext, playbackPlays } = await import(
      "./pcmPlayback"
    );
    await resumePlaybackContext();
    const playback = LockableContext.last!;
    playback.wedged = true;
    setPageVisibility("hidden");
    playback.lock();
    setPageVisibility("visible");
    await vi.advanceTimersByTimeAsync(3000);
    expect(playback.suspend).toHaveBeenCalledTimes(3);

    for (let chunk = 0; chunk < 40; chunk++) {
      playbackPlays(playback as unknown as AudioContext);
      await vi.advanceTimersByTimeAsync(500);
    }

    expect(playback.suspend).toHaveBeenCalledTimes(3 + 5 * 3);
  });

  it("tries again when read aloud is tapped, after the revival on return did not take", async () => {
    const { resumePlaybackContext } = await import("./pcmPlayback");
    await resumePlaybackContext();
    const playback = LockableContext.last!;
    playback.wedged = true;
    setPageVisibility("hidden");
    playback.lock();
    setPageVisibility("visible");
    await vi.advanceTimersByTimeAsync(3000);

    playback.wedged = false;
    const tapped = resumePlaybackContext();
    await vi.advanceTimersByTimeAsync(2000);
    const context = await tapped;

    const before = context.currentTime;
    vi.advanceTimersByTime(500);
    expect(context.currentTime).toBeGreaterThan(before);
  });

  it("leaves a clock alone that moves on after the page is shown", async () => {
    const { resumePlaybackContext } = await import("./pcmPlayback");
    await resumePlaybackContext();
    const playback = LockableContext.last!;

    setPageVisibility("hidden");
    setPageVisibility("visible");
    await vi.advanceTimersByTimeAsync(2000);

    expect(playback.suspend).not.toHaveBeenCalled();
  });
});

describe("the voice as conversation audio", () => {
  class StreamContext {
    static last: StreamContext | undefined;
    state: AudioContextState = "running";
    currentTime = 0;
    destination = { name: "speakers" };
    gains: {
      connect: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
      gain: { setTargetAtTime: ReturnType<typeof vi.fn> };
    }[] = [];
    streams: { context: StreamContext; stream: { id: string } }[] = [];
    constructor() {
      StreamContext.last = this;
    }
    resume = vi.fn(async () => {});
    suspend = vi.fn(async () => {});
    createMediaStreamDestination() {
      const node = { context: this, stream: { id: "voice" } };
      this.streams.push(node);
      return node;
    }
    createGain() {
      const gain = {
        context: this,
        gain: { value: 1, setTargetAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      this.gains.push(gain);
      return gain;
    }
    createBuffer(_channels: number, length: number, rate: number) {
      return {
        duration: length / rate,
        getChannelData: () => new Float32Array(length),
      };
    }
    sources: { onended: (() => void) | null }[] = [];
    createBufferSource() {
      const source = {
        connect: vi.fn(),
        disconnect: vi.fn(),
        stop: vi.fn(),
        start: vi.fn(),
        buffer: null,
        onended: null,
      };
      this.sources.push(source);
      return source;
    }
  }

  let elements: HTMLAudioElement[];
  let paused: boolean;
  let pauses: number;
  let answer: () => Promise<void>;
  const hadSrcObject = "srcObject" in HTMLMediaElement.prototype;

  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("AudioContext", StreamContext);
    if (!hadSrcObject)
      Object.defineProperty(HTMLMediaElement.prototype, "srcObject", {
        configurable: true,
        writable: true,
        value: null,
      });
    elements = [];
    paused = true;
    pauses = 0;
    answer = async () => {
      paused = false;
    };
    vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockImplementation(
      () => paused,
    );
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      if (!elements.includes(this)) elements.push(this);
      return answer();
    });
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      pauses += 1;
      paused = true;
      this.dispatchEvent(new Event("pause"));
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    delete window.ERATO_VOICE_MEDIA_STREAM_OUTPUT;
    if (!hadSrcObject)
      delete (HTMLMediaElement.prototype as { srcObject?: unknown }).srcObject;
  });

  /** A microphone with echo cancellation, as the recorder hands it over. */
  const microphone = (track = { readyState: "live" }) =>
    ({ getAudioTracks: () => [track] }) as unknown as MediaStream;

  /** Queues enough audio to start a voice, so its output exists. */
  const speak = async (
    playback: AudioContext,
    { createPcmQueue }: typeof import("./pcmPlayback"),
  ) => {
    createPcmQueue(vi.fn()).enqueue(playback, pcm(500), RATE);
  };
  const lastConnection = (playback: StreamContext) =>
    playback.gains[0].connect.mock.calls.at(-1)?.[0];

  it("plays the voice as a media stream while a microphone with echo cancellation is open, started within the tap", async () => {
    const playback = await import("./pcmPlayback");
    playback.voiceHeardBy(microphone());
    const tapped = playback.resumePlaybackContext();
    expect(elements).toHaveLength(1);
    const context = await tapped;
    await speak(context, playback);

    const shared = StreamContext.last!;
    expect(elements[0].srcObject).toBe(shared.streams[0].stream);
    expect(lastConnection(shared)).toBe(shared.streams[0]);
  });

  it("plays as before while no microphone listens, as for read aloud", async () => {
    const playback = await import("./pcmPlayback");
    const context = await playback.resumePlaybackContext();
    await speak(context, playback);

    expect(elements).toHaveLength(0);
    const shared = StreamContext.last!;
    expect(lastConnection(shared)).toBe(shared.destination);
  });

  it("moves the voice to the stream when a microphone opens while it plays", async () => {
    const playback = await import("./pcmPlayback");
    const context = await playback.resumePlaybackContext();
    await speak(context, playback);
    const shared = StreamContext.last!;
    expect(lastConnection(shared)).toBe(shared.destination);

    playback.voiceHeardBy(microphone());
    await vi.advanceTimersByTimeAsync(0);

    expect(shared.gains[0].disconnect).toHaveBeenCalled();
    expect(lastConnection(shared)).toBe(shared.streams[0]);
  });

  it("goes back to the speakers and pauses the element once the microphone is closed", async () => {
    const playback = await import("./pcmPlayback");
    const track = { readyState: "live" };
    playback.voiceHeardBy(microphone(track));
    const context = await playback.resumePlaybackContext();
    await vi.advanceTimersByTimeAsync(0);
    await speak(context, playback);
    const shared = StreamContext.last!;

    track.readyState = "ended";
    await vi.advanceTimersByTimeAsync(1000);

    expect(pauses).toBe(1);
    expect(lastConnection(shared)).toBe(shared.destination);
  });

  it("plays through the speakers as before when the element may not play, and moves to the stream on the next tap", async () => {
    answer = () => Promise.reject(new DOMException("", "NotAllowedError"));
    const playback = await import("./pcmPlayback");
    playback.voiceHeardBy(microphone());
    const context = await playback.resumePlaybackContext();
    await vi.advanceTimersByTimeAsync(0);
    await speak(context, playback);
    const shared = StreamContext.last!;
    expect(lastConnection(shared)).toBe(shared.destination);

    answer = async () => {
      paused = false;
    };
    await playback.resumePlaybackContext();
    await vi.advanceTimersByTimeAsync(0);

    expect(lastConnection(shared)).toBe(shared.streams[0]);
    expect(elements).toHaveLength(1);
  });

  it("goes back to the speakers at once when the browser pauses the element, and to the stream again once the page is shown", async () => {
    const playback = await import("./pcmPlayback");
    playback.voiceHeardBy(microphone());
    const context = await playback.resumePlaybackContext();
    await vi.advanceTimersByTimeAsync(0);
    await speak(context, playback);
    const shared = StreamContext.last!;

    paused = true;
    elements[0].dispatchEvent(new Event("pause"));
    expect(lastConnection(shared)).toBe(shared.destination);

    setPageVisibility("hidden");
    setPageVisibility("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(lastConnection(shared)).toBe(shared.streams[0]);
  });

  it("keeps the lowering on the voice while it plays as a stream", async () => {
    const playback = await import("./pcmPlayback");
    playback.voiceHeardBy(microphone());
    const context = await playback.resumePlaybackContext();
    await vi.advanceTimersByTimeAsync(0);
    await speak(context, playback);

    playback.lowerVoice(true);

    expect(
      StreamContext.last!.gains[0].gain.setTargetAtTime,
    ).toHaveBeenCalledWith(0.3, 0, 0.03);
  });

  it("plays as before where the browser has no media stream output", async () => {
    vi.stubGlobal(
      "AudioContext",
      class extends StreamContext {
        constructor() {
          super();
          Object.assign(this, { createMediaStreamDestination: undefined });
        }
      },
    );
    const playback = await import("./pcmPlayback");
    playback.voiceHeardBy(microphone());
    const context = await playback.resumePlaybackContext();
    await speak(context, playback);

    expect(elements).toHaveLength(0);
    const shared = StreamContext.last!;
    expect(lastConnection(shared)).toBe(shared.destination);
  });

  it.each([false, "false"])(
    "plays as before when the deployment turns the stream off (%s)",
    async (setting) => {
      window.ERATO_VOICE_MEDIA_STREAM_OUTPUT = setting;
      const playback = await import("./pcmPlayback");
      playback.voiceHeardBy(microphone());
      const context = await playback.resumePlaybackContext();
      await speak(context, playback);

      expect(elements).toHaveLength(0);
      const shared = StreamContext.last!;
      expect(shared.streams).toHaveLength(0);
      expect(lastConnection(shared)).toBe(shared.destination);
    },
  );
});
