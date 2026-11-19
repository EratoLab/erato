import { describe, expect, it } from "vitest";

import { nextWaitStep } from "./plan";

import type { WaitTiming, WaitTurnState } from "./plan";

const timing: WaitTiming = {
  firstAfterMs: 3000,
  toolAfterMs: 1500,
  stillAfterMs: 12000,
  stillQuietMs: 8000,
  longAfterMs: 22000,
  stillRepeatMs: 18000,
  minGapMs: 4000,
  maxPerTurn: 3,
};

const turn = (patch: Partial<WaitTurnState> = {}): WaitTurnState => ({
  speechEndedAt: 0,
  transcriptAt: 3200,
  answerStarted: false,
  ended: false,
  said: [],
  tools: [],
  unavailable: [],
  ...patch,
});

describe("nextWaitStep", () => {
  it("says nothing before the opener is due and waits for the transcript", () => {
    expect(nextWaitStep("normal", timing, turn(), 1000)).toEqual({
      kind: "wake",
      at: 3200,
    });
    expect(nextWaitStep("normal", timing, turn(), 3200)).toEqual({
      kind: "say",
      line: "opener",
    });
  });

  it("says nothing once the answer started, the turn ended, or it is off", () => {
    expect(
      nextWaitStep("normal", timing, turn({ answerStarted: true }), 9000),
    ).toEqual({ kind: "done" });
    expect(nextWaitStep("normal", timing, turn({ ended: true }), 9000)).toEqual(
      { kind: "done" },
    );
    expect(nextWaitStep("off", timing, turn(), 9000)).toEqual({
      kind: "done",
    });
  });

  it("waits while a line plays", () => {
    const playing = turn({ said: [{ kind: "opener", startedAt: 3200 }] });
    expect(nextWaitStep("normal", timing, playing, 3500)).toEqual({
      kind: "wait",
    });
  });

  it("keeps the opener out of long_only and starts with the still line", () => {
    expect(nextWaitStep("long_only", timing, turn(), 5000)).toEqual({
      kind: "wake",
      at: 12000,
    });
    expect(nextWaitStep("long_only", timing, turn(), 12000)).toEqual({
      kind: "say",
      line: "still",
      repeat: false,
    });
  });

  it("says a slow tool's line after the gap and before the still line", () => {
    const working = turn({
      said: [{ kind: "opener", startedAt: 3200, endedAt: 4000 }],
      tools: [
        { id: "a", startedAt: 5600, endedAt: 7200, ready: true },
        { id: "b", startedAt: 8400, ready: true },
      ],
    });
    // Tool a ended before its line was due; b is due at 9.9 s.
    expect(nextWaitStep("normal", timing, working, 8500)).toEqual({
      kind: "wake",
      at: 9900,
    });
    expect(nextWaitStep("normal", timing, working, 9900)).toEqual({
      kind: "say",
      line: "tool",
      toolCallId: "b",
    });
  });

  it("holds a tool line to the gap after the last line", () => {
    const soon = turn({
      said: [{ kind: "opener", startedAt: 3200, endedAt: 4000 }],
      tools: [{ id: "a", startedAt: 5000, ready: true }],
    });
    expect(nextWaitStep("normal", timing, soon, 6600)).toEqual({
      kind: "wake",
      at: 8000,
    });
  });

  it("skips the still line while tool lines keep coming", () => {
    const busy = turn({
      said: [
        { kind: "opener", startedAt: 3200, endedAt: 4000 },
        { kind: "tool", toolCallId: "b", startedAt: 9900, endedAt: 11600 },
      ],
    });
    expect(nextWaitStep("normal", timing, busy, 12000)).toEqual({
      kind: "wake",
      at: 19600,
    });
  });

  it("keeps the long line outside the cap", () => {
    const full = turn({
      said: [
        { kind: "opener", startedAt: 3200, endedAt: 4000 },
        { kind: "tool", toolCallId: "b", startedAt: 9900, endedAt: 11600 },
        { kind: "tool", toolCallId: "c", startedAt: 15700, endedAt: 17000 },
      ],
      tools: [{ id: "d", startedAt: 17500, ready: true }],
    });
    // The cap holds back a fourth tool line, never the long line.
    expect(nextWaitStep("normal", timing, full, 21500)).toEqual({
      kind: "wake",
      at: 22000,
    });
    expect(nextWaitStep("normal", timing, full, 22000)).toEqual({
      kind: "say",
      line: "long",
    });
  });

  it("says still on it again after the long line until the turn ends", () => {
    const long = turn({
      said: [
        { kind: "opener", startedAt: 3200, endedAt: 4000 },
        { kind: "still", startedAt: 12000, endedAt: 12800 },
        { kind: "long", startedAt: 22000, endedAt: 25000 },
      ],
    });
    expect(nextWaitStep("normal", timing, long, 26000)).toEqual({
      kind: "wake",
      at: 43000,
    });
    expect(nextWaitStep("normal", timing, long, 43000)).toEqual({
      kind: "say",
      line: "still",
      repeat: true,
    });
    const again = turn({
      ...long,
      said: [
        ...long.said,
        { kind: "still", repeat: true, startedAt: 43000, endedAt: 44000 },
      ],
    });
    expect(nextWaitStep("normal", timing, again, 50000)).toEqual({
      kind: "wake",
      at: 62000,
    });
    expect(
      nextWaitStep("normal", { ...timing, stillRepeatMs: 0 }, long, 60000),
    ).toEqual({ kind: "done" });
  });

  it("says nothing at all with a cap of 0", () => {
    expect(
      nextWaitStep("normal", { ...timing, maxPerTurn: 0 }, turn(), 30000),
    ).toEqual({ kind: "done" });
  });

  it("waits for a tool line that is still loading", () => {
    const loading = turn({
      said: [{ kind: "opener", startedAt: 3200, endedAt: 4000 }],
      tools: [{ id: "a", startedAt: 5000, ready: false }],
      unavailable: ["still", "long"],
    });
    expect(nextWaitStep("normal", timing, loading, 9000)).toEqual({
      kind: "wait",
    });
  });

  it("says the long line after the still line", () => {
    const long = turn({
      said: [
        { kind: "opener", startedAt: 3200, endedAt: 4000 },
        { kind: "still", startedAt: 12000, endedAt: 12800 },
      ],
    });
    expect(nextWaitStep("normal", timing, long, 22000)).toEqual({
      kind: "say",
      line: "long",
    });
  });

  it("leaves out a kind without lines", () => {
    expect(
      nextWaitStep("normal", timing, turn({ unavailable: ["opener"] }), 5000),
    ).toEqual({ kind: "wake", at: 12000 });
  });
});
