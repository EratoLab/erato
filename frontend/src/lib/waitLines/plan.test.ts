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
  stillRepeatMax: 3,
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

  it("stops repeating after stillRepeatMax lines, so a hung turn goes quiet", () => {
    const repeated = turn({
      said: [
        { kind: "opener", startedAt: 3200, endedAt: 4000 },
        { kind: "still", startedAt: 12000, endedAt: 12800 },
        { kind: "long", startedAt: 22000, endedAt: 25000 },
        { kind: "still", repeat: true, startedAt: 43000, endedAt: 44000 },
        { kind: "still", repeat: true, startedAt: 62000, endedAt: 63000 },
        { kind: "still", repeat: true, startedAt: 81000, endedAt: 82000 },
      ],
    });
    expect(nextWaitStep("normal", timing, repeated, 600000)).toEqual({
      kind: "done",
    });
  });

  it("leaves the opener out when the lines were confirmed too late for it", () => {
    // Confirmed at 9 s: the opener was due at 3.2 s.
    expect(nextWaitStep("normal", timing, turn(), 9000)).toEqual({
      kind: "wake",
      at: 12000,
    });
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

  it("pauses after the reply's spoken part until a tool call starts", () => {
    const spoke = turn({
      said: [
        { kind: "opener", startedAt: 3200, endedAt: 4000 },
        { kind: "reply", startedAt: 9000, endedAt: 16000 },
      ],
    });
    expect(nextWaitStep("normal", timing, spoke, 40000)).toEqual({
      kind: "wait",
    });
    const calling = turn({
      ...spoke,
      tools: [{ id: "a", startedAt: 16500, ready: true }],
    });
    // The gap counts from the spoken part's end.
    expect(nextWaitStep("normal", timing, calling, 18000)).toEqual({
      kind: "wake",
      at: 20000,
    });
    expect(nextWaitStep("normal", timing, calling, 20000)).toEqual({
      kind: "say",
      line: "tool",
      toolCallId: "a",
    });
  });

  it("goes on with the fixed lines after a spoken part and a call without a line", () => {
    const calling = turn({
      said: [{ kind: "reply", startedAt: 1000, endedAt: 3000 }],
      tools: [{ id: "a", startedAt: 3500, ready: false, silent: true }],
    });
    expect(nextWaitStep("normal", timing, calling, 3600)).toEqual({
      kind: "wake",
      at: 12000,
    });
    expect(nextWaitStep("normal", timing, calling, 12000)).toEqual({
      kind: "say",
      line: "still",
      repeat: false,
    });
    // The call may have ended: the model still works on the answer.
    const ended = turn({
      ...calling,
      tools: [{ ...calling.tools[0], endedAt: 5000 }],
    });
    expect(nextWaitStep("normal", timing, ended, 12000)).toEqual({
      kind: "say",
      line: "still",
      repeat: false,
    });
  });

  it("counts the reply's spoken part toward the cap", () => {
    const full = turn({
      said: [
        { kind: "opener", startedAt: 3200, endedAt: 4000 },
        { kind: "reply", startedAt: 5000, endedAt: 9000 },
        { kind: "tool", toolCallId: "a", startedAt: 13000, endedAt: 14000 },
      ],
      tools: [
        { id: "a", startedAt: 9500, ready: true },
        { id: "b", startedAt: 15000, ready: true },
      ],
    });
    expect(nextWaitStep("normal", timing, full, 21000)).toEqual({
      kind: "wake",
      at: 22000,
    });
  });

  it("pauses again at a later spoken part", () => {
    const again = turn({
      said: [
        { kind: "reply", startedAt: 1000, endedAt: 3000 },
        { kind: "reply", startedAt: 9000, endedAt: 11000 },
      ],
      tools: [{ id: "a", startedAt: 3500, endedAt: 8000, ready: true }],
    });
    expect(nextWaitStep("normal", timing, again, 30000)).toEqual({
      kind: "wait",
    });
  });

  it("leaves out a kind without lines", () => {
    expect(
      nextWaitStep("normal", timing, turn({ unavailable: ["opener"] }), 5000),
    ).toEqual({ kind: "wake", at: 12000 });
  });
});
