import { describe, expect, it } from "vitest";

import {
  applySidecarTraceSteps,
  mergeSidecarTraces,
  sidecarTraceRows,
} from "./traceEvents";

import type { SidecarLocalTraceStep } from "@erato/desktop-sidecar-protocol";

const step = (sequence: number, overrides = {}) => ({
  sequence,
  id: `step-${sequence}`,
  status: "ok",
  startedAtOffsetMs: sequence * 10,
  ...overrides,
});

describe("sidecar trace events", () => {
  it("applies the same log twice without duplicating steps", () => {
    const log = [step(0), step(1)];
    expect(applySidecarTraceSteps(log, log)).toHaveLength(2);
  });

  it("lets a later step supersede an earlier one with the same sequence", () => {
    const applied = applySidecarTraceSteps(
      [step(0, { status: "running" })],
      [step(0, { status: "ok", durationMs: 42 })],
    );
    expect(applied).toHaveLength(1);
    expect(applied[0].status).toBe("ok");
    expect(applied[0].durationMs).toBe(42);
  });

  it("renders a batched and an incrementally applied log identically", () => {
    const batch = [step(0), step(1), step(2)];
    const incremental = [step(0)]
      .concat(step(1))
      .reduce<
        SidecarLocalTraceStep[]
      >((previous, next) => applySidecarTraceSteps(previous, [next]), []);
    const finished = applySidecarTraceSteps(incremental, [step(2)]);
    expect(finished).toEqual(applySidecarTraceSteps([], batch));
  });

  it("orders by start offset, falling back to sequence", () => {
    const applied = applySidecarTraceSteps(
      [],
      [
        step(2, { startedAtOffsetMs: 5 }),
        step(1, { startedAtOffsetMs: 5 }),
        step(0, { startedAtOffsetMs: 1 }),
      ],
    );
    expect(applied.map((item) => item.sequence)).toEqual([0, 1, 2]);
  });

  it("nests steps under the step they ran inside", () => {
    const rows = sidecarTraceRows({
      steps: [
        step(0),
        step(1),
        step(2, { parentSequence: 1 }),
        step(3, { parentSequence: 99 }),
      ],
    });
    expect(rows.map((row) => [row.step.sequence, row.depth])).toEqual([
      [0, 0],
      [1, 0],
      [2, 1],
      // Unknown parent: shown at top level rather than hidden.
      [3, 0],
    ]);
  });

  it("merges traces while keeping the newest envelope fields", () => {
    const merged = mergeSidecarTraces(
      { steps: [step(0)], totalDurationMs: 10 },
      { steps: [step(1)], totalDurationMs: 25 },
    );
    expect(merged.totalDurationMs).toBe(25);
    expect(merged.steps).toHaveLength(2);
  });
});
