import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WaitLinesResponse } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const fetchWaitLines = vi.fn();
vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  fetchWaitLines: (...args: unknown[]) => fetchWaitLines(...args) as unknown,
}));
const sse = vi.fn();
vi.mock("@/utils/sse/sseClient", () => ({
  createSSEConnection: (...args: unknown[]) => sse(...args) as unknown,
}));

/** Every source plays for half a second and ends when the test says so. */
const sources: { onended: (() => void) | null; startedAt: number }[] = [];
class MockAudioContext {
  state = "running";
  currentTime = 1;
  destination = {};
  resume = vi.fn(async () => {});
  createBuffer(_channels: number, length: number, rate: number) {
    return {
      duration: Math.max(length / rate, 0.5),
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
      start: (time: number) => {
        source.startedAt = time;
      },
      buffer: null,
      onended: null as (() => void) | null,
      startedAt: -1,
    };
    sources.push(source);
    return source;
  }
}

const response = (
  patch: Partial<WaitLinesResponse> = {},
): WaitLinesResponse => ({
  amount: "normal",
  source: "deployment",
  user_choice: true,
  language: "de",
  voice: "v1",
  timing: {
    first_after_ms: 3000,
    tool_after_ms: 1500,
    still_after_ms: 12000,
    still_quiet_ms: 8000,
    long_after_ms: 22000,
    min_gap_ms: 4000,
    max_per_turn: 3,
    taper_after_turns: 3,
  },
  lines: [
    {
      slot: "opener",
      text: "Einen Moment.",
      audio: "AQIDBA==",
      sample_rate: 24000,
    },
    {
      slot: "still",
      text: "Ich bin noch dran.",
      audio: "AQIDBA==",
      sample_rate: 24000,
    },
  ],
  tools: { list: "Ich sehe mir die {table} an." },
  ...patch,
});

const setup = async (patch?: Partial<WaitLinesResponse>) => {
  fetchWaitLines.mockResolvedValue(response(patch));
  const playback = await import("./speechPlayback");
  const pcm = await import("./pcmPlayback");
  await pcm.resumePlaybackContext();
  playback.useSpeechPlayback.setState({ conversational: true, enabled: true });
  const lines = await import("./waitLines");
  await lines.prepareWaitLines();
  return { playback, lines };
};

const endSources = () => {
  for (const source of sources.splice(0)) source.onended?.();
};

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(0);
  sources.length = 0;
  fetchWaitLines.mockReset();
  sse.mockReset();
  sse.mockReturnValue(() => {});
  vi.stubGlobal("AudioContext", MockAudioContext);
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("wait lines", () => {
  it("says the opener once the time has come, not before", async () => {
    const { playback, lines } = await setup();
    playback.beginSpeechResponse("s");
    lines.beginWaitTurn("s");
    await vi.advanceTimersByTimeAsync(2900);
    expect(sources).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(sources).toHaveLength(1);
  });

  it("holds the answer back until the line has finished", async () => {
    const { playback, lines } = await setup();
    playback.beginSpeechResponse("s");
    lines.beginWaitTurn("s");
    await vi.advanceTimersByTimeAsync(3000);
    expect(sources).toHaveLength(1);
    lines.waitTurnAnswered("s");
    playback.playSpeechChunk("m", 0, "AQIDBA==", 24000, "s");
    expect(sources).toHaveLength(1);
    endSources();
    await vi.advanceTimersByTimeAsync(200);
    expect(sources.length).toBeGreaterThan(0);
    expect(playback.useSpeechPlayback.getState().playing).toBe(true);
  });

  it("says nothing once the answer has started", async () => {
    const { playback, lines } = await setup();
    playback.beginSpeechResponse("s");
    lines.beginWaitTurn("s");
    lines.waitTurnAnswered("s");
    await vi.advanceTimersByTimeAsync(30000);
    expect(sources).toHaveLength(0);
  });

  it("says nothing for a turn that is not read back", async () => {
    const { lines } = await setup();
    lines.beginWaitTurn("s");
    await vi.advanceTimersByTimeAsync(5000);
    expect(sources).toHaveLength(0);
  });

  it("falls silent when the voice is stopped", async () => {
    const { playback, lines } = await setup();
    playback.beginSpeechResponse("s");
    lines.beginWaitTurn("s");
    await vi.advanceTimersByTimeAsync(3000);
    expect(sources).toHaveLength(1);
    playback.stopSpeechPlayback();
    sources.length = 0;
    await vi.advanceTimersByTimeAsync(30000);
    expect(sources).toHaveLength(0);
    await expect(lines.afterWaitLine()).resolves.toBeUndefined();
  });

  it("asks for a tool line only for a call it can name", async () => {
    const { playback, lines } = await setup();
    playback.beginSpeechResponse("s");
    lines.beginWaitTurn("s");
    lines.waitTurnTool("s", "m", "write", "in_progress", {
      action: "update",
      object_kind: "row",
      source: "rules",
    } as never);
    expect(sse).not.toHaveBeenCalled();
    lines.waitTurnTool("s", "m", "read", "in_progress", {
      action: "other",
      object_kind: "row",
      source: "rules",
      read: { object_kind: "row", query: { tables: ["opportunity"] } },
      spoken_names: { de: { tables: { opportunity: "Verkaufschancen" } } },
    } as never);
    expect(sse).toHaveBeenCalledOnce();
    const [path, options] = sse.mock.calls[0] as [string, { body: string }];
    expect(path).toContain("/me/messages/m/progress-speech");
    expect(JSON.parse(options.body)).toEqual({
      text: "Ich sehe mir die Verkaufschancen an.",
    });
  });

  it("counts as the voice speaking while a line plays and the answer waits", async () => {
    const { playback, lines } = await setup();
    playback.beginSpeechResponse("s");
    lines.beginWaitTurn("s");
    await vi.advanceTimersByTimeAsync(3000);
    // The microphone stays closed and the stop button shows meanwhile.
    expect(playback.useSpeechPlayback.getState().playing).toBe(true);
    lines.endWaitTurn("s");
    endSources();
    expect(playback.useSpeechPlayback.getState().playing).toBe(true);
    await vi.advanceTimersByTimeAsync(200);
    expect(playback.useSpeechPlayback.getState().playing).toBe(false);
  });

  it("lets a waiting card go only after the held answer is queued", async () => {
    const { playback, lines } = await setup();
    playback.beginSpeechResponse("s");
    lines.beginWaitTurn("s");
    await vi.advanceTimersByTimeAsync(3000);
    lines.waitTurnAnswered("s");
    playback.playSpeechChunk("m", 0, "AQIDBA==", 24000, "s");
    let cardMayStart = false;
    void lines.afterWaitLine().then(() => {
      cardMayStart = true;
    });
    endSources();
    await vi.advanceTimersByTimeAsync(0);
    expect(cardMayStart).toBe(false);
    expect(lines.waitLinePlaying()).toBe(true);
    await vi.advanceTimersByTimeAsync(200);
    expect(cardMayStart).toBe(true);
    // The answer is on the reply queue, so the card waits for the voice.
    expect(sources.length).toBeGreaterThan(0);
    expect(playback.useSpeechPlayback.getState().playing).toBe(true);
  });

  it("asks for one call's line once, whatever its updates", async () => {
    const { playback, lines } = await setup();
    playback.beginSpeechResponse("s");
    lines.beginWaitTurn("s");
    const label = {
      action: "other",
      object_kind: "row",
      source: "rules",
      read: { object_kind: "row", query: { tables: ["opportunity"] } },
      spoken_names: { de: { tables: { opportunity: "Verkaufschancen" } } },
    } as never;
    lines.waitTurnTool("s", "m", "read", "in_progress", label);
    const options = sse.mock.calls[0][1] as { onClose: () => void };
    options.onClose();
    lines.waitTurnTool("s", "m", "read", "in_progress", label);
    expect(sse).toHaveBeenCalledOnce();
  });

  it("drops lines when the voice changes", async () => {
    const { lines } = await setup();
    fetchWaitLines.mockResolvedValue(response({ voice: "v2", lines: [] }));
    const next = await lines.prepareWaitLines();
    expect(next?.voice).toBe("v2");
    expect(next?.clips.opener).toHaveLength(0);
  });
});
