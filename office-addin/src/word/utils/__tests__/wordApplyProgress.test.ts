import { afterEach, describe, expect, it, vi } from "vitest";

import { trackWordApply, yieldToPaint } from "../wordApplyProgress";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("trackWordApply", () => {
  it("reports stages in order and logs rounded per-stage durations", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    let now = 0;
    vi.spyOn(globalThis.performance, "now").mockImplementation(() => now);
    const stages: string[] = [];
    const progress = trackWordApply("plan", (stage) => stages.push(stage));

    progress.stage("checking");
    now = 12.4;
    progress.stage("backup");
    now = 40;
    progress.stage("writing");
    now = 41;
    progress.stage("verifying");
    now = 60.6;
    progress.finish("applied");

    expect(stages).toEqual(["checking", "backup", "writing", "verifying"]);
    expect(debug).toHaveBeenCalledWith("[erato] Word apply timings (ms)", {
      kind: "plan",
      outcome: "applied",
      total: 61,
      checking: 12,
      backup: 28,
      writing: 1,
      verifying: 20,
    });
  });
});

describe("yieldToPaint", () => {
  it("resolves after a frame", async () => {
    vi.useFakeTimers();
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      frames.push(callback),
    );
    let resolved = false;
    void yieldToPaint().then(() => {
      resolved = true;
    });
    frames.forEach((frame) => frame(0));
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(true);
  });

  it("still resolves when no frame is delivered, as in a hidden pane", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", () => 0);
    let resolved = false;
    void yieldToPaint().then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(49);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toBe(true);
  });
});
