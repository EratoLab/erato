import { afterEach, describe, expect, it } from "vitest";

import {
  clearSidecarLocalTrace,
  getSidecarLocalTrace,
  markSidecarLocalTraceStopped,
  persistedSidecarLocalTrace,
  recordSidecarLocalTrace,
  sanitizeSidecarLocalTrace,
  useSidecarLocalTraceStore,
} from "./localTraceStore";

const step = (sequence: number, status: string, extra: object = {}) => ({
  sequence,
  id: "expandQuery",
  status,
  ...extra,
});

describe("sanitizeSidecarLocalTrace", () => {
  it("rejects values that are not trace-shaped", () => {
    expect(sanitizeSidecarLocalTrace(undefined)).toBeUndefined();
    expect(sanitizeSidecarLocalTrace(null)).toBeUndefined();
    expect(sanitizeSidecarLocalTrace("trace")).toBeUndefined();
    expect(sanitizeSidecarLocalTrace({})).toBeUndefined();
    expect(
      sanitizeSidecarLocalTrace({ steps: "not-an-array" }),
    ).toBeUndefined();
  });

  it("drops steps without their required identity and keeps valid ones", () => {
    const trace = sanitizeSidecarLocalTrace({
      steps: [
        { id: "noSequence", status: "ok" },
        { sequence: -1, id: "negative", status: "ok" },
        { sequence: 1.5, id: "fractional", status: "ok" },
        step(0, "ok"),
      ],
      totalDurationMs: 12,
    });
    expect(trace?.steps).toEqual([step(0, "ok")]);
    expect(trace?.totalDurationMs).toBe(12);
  });

  it("bounds strings, counts, and the step list", () => {
    const trace = sanitizeSidecarLocalTrace({
      steps: [
        step(0, "ok", {
          detail: "x".repeat(4000),
          model: "m".repeat(600),
          counts: Object.fromEntries(
            Array.from({ length: 40 }, (_, index) => [`key${index}`, 1]),
          ),
          unknownExtra: { nested: true },
        }),
        ...Array.from({ length: 60 }, (_, index) => step(index + 1, "ok")),
      ],
    });
    const first = trace?.steps[0];
    expect(first?.detail).toHaveLength(512);
    expect(first?.model).toHaveLength(256);
    expect(Object.keys(first?.counts ?? {})).toHaveLength(16);
    expect(first).not.toHaveProperty("unknownExtra");
    expect(trace?.steps.length).toBeLessThanOrEqual(32);
  });

  it("drops malformed count values and oversized keys", () => {
    const trace = sanitizeSidecarLocalTrace({
      steps: [
        step(0, "ok", {
          counts: {
            good: 3,
            negative: -1,
            fractional: 1.5,
            text: "nope",
            ["k".repeat(100)]: 1,
          },
        }),
      ],
    });
    expect(trace?.steps[0]?.counts).toEqual({ good: 3 });
  });
});

describe("localTraceStore", () => {
  afterEach(() => useSidecarLocalTraceStore.setState({ traces: {} }));

  it("refuses to record something that is not a trace", () => {
    recordSidecarLocalTrace("call-1", { steps: undefined } as never);
    expect(getSidecarLocalTrace("call-1")).toBeUndefined();
  });

  it("keeps an actively recorded trace out of the eviction window", () => {
    recordSidecarLocalTrace("active", { steps: [step(0, "running")] });
    for (let index = 0; index < 49; index += 1) {
      recordSidecarLocalTrace(`filler-${index}`, { steps: [step(0, "ok")] });
    }
    // A poll touches the active entry; the next insert must evict the oldest
    // filler instead of the streaming trace.
    recordSidecarLocalTrace("active", { steps: [step(1, "running")] });
    recordSidecarLocalTrace("one-more", { steps: [step(0, "ok")] });

    expect(getSidecarLocalTrace("active")?.steps).toHaveLength(2);
    expect(getSidecarLocalTrace("filler-0")).toBeUndefined();
  });

  it("clears a tool call's trace so a fresh run starts from zero", () => {
    recordSidecarLocalTrace("call-1", { steps: [step(0, "ok")] });
    clearSidecarLocalTrace("call-1");
    expect(getSidecarLocalTrace("call-1")).toBeUndefined();
  });

  it("settles running steps when the request ends without an observation", () => {
    recordSidecarLocalTrace("call-1", {
      steps: [
        step(0, "ok", { detail: "kept" }),
        step(1, "running"),
        step(2, "someFutureStatus"),
      ],
    });
    markSidecarLocalTraceStopped("call-1");

    const steps = getSidecarLocalTrace("call-1")?.steps ?? [];
    expect(steps[0]).toMatchObject({ status: "ok", detail: "kept" });
    expect(steps[1]).toMatchObject({ status: "skipped", detail: "cancelled" });
    expect(steps[2]).toMatchObject({ status: "skipped", detail: "cancelled" });
  });
});

describe("persistedSidecarLocalTrace", () => {
  it("sanitizes the persisted payload instead of trusting it", () => {
    expect(
      persistedSidecarLocalTrace({ result: { localTrace: {} } }),
    ).toBeUndefined();
    const trace = persistedSidecarLocalTrace({
      result: {
        localTrace: {
          steps: [step(0, "ok", { detail: "y".repeat(4000) })],
        },
      },
    });
    expect(trace?.steps[0]?.detail).toHaveLength(512);
  });
});
